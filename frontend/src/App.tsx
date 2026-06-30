import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount } from "wagmi";
import * as d3 from "d3";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { CONTRACT_ADDRESS } from "./chain";
import {
  ACCOUNT_STATUS,
  SNAPSHOT_STATUS,
  advanceEpoch,
  getConstants,
  getCounts,
  getSnapshot,
  listAccountsOf,
  loadDossiers,
  penaliseLate,
  registerAccount,
  scoreSnapshot,
  setAdmin,
  submitSnapshot,
  unfreezeAccount,
  type ConstantsView,
  type CountsView,
  type DossierRow,
  type RungView,
  type SnapshotView,
  type Verdict,
} from "./contractService";

gsap.registerPlugin(ScrollTrigger);

type Hex = `0x${string}`;

const VERDICTS: Verdict[] = ["HEALTHY", "DRIFTING", "AT_RISK", "INSOLVENT"];

function verdictKey(v: string): string {
  return (v || "").toLowerCase().replace("_", "");
}

function fmtWei(wei: string): string {
  // Render large wei values as grouped integers plus an ETH-ish reduction.
  let s = wei || "0";
  try {
    s = BigInt(wei).toString();
  } catch {
    s = "0";
  }
  const grouped = s.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return grouped;
}

function fmtRatio(bps: number): string {
  if (!bps) return "—";
  return (bps / 100).toFixed(2) + "%";
}

function stamp(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 19) + "Z";
}

/* ─── Risk gauge (d3, horizontal 0..1000 bps) ─────────────────────────────── */
function RiskGauge({
  risk,
  consts,
}: {
  risk: number;
  consts: ConstantsView | null;
}) {
  const ref = useRef<SVGSVGElement | null>(null);
  const drifting = consts?.DRIFTING_FLOOR ?? 280;
  const atRisk = consts?.AT_RISK_FLOOR ?? 550;
  const insolvent = consts?.INSOLVENT_FLOOR ?? 800;

  useEffect(() => {
    const svg = d3.select(ref.current);
    svg.selectAll("*").remove();
    const W = 640;
    const m = { l: 14, r: 14, t: 34, b: 30 };
    const x = d3.scaleLinear().domain([0, 1000]).range([m.l, W - m.r]);

    const bands: [number, number, string, string][] = [
      [0, drifting, "#5C7C3F", "HEALTHY"],
      [drifting, atRisk, "#B7892F", "DRIFTING"],
      [atRisk, insolvent, "#C44A2F", "AT_RISK"],
      [insolvent, 1000, "#0B1733", "INSOLVENT"],
    ];

    const barY = m.t;
    const barH = 18;

    bands.forEach(([a, c, color, label]) => {
      svg
        .append("rect")
        .attr("x", x(a))
        .attr("y", barY)
        .attr("width", Math.max(0, x(c) - x(a)))
        .attr("height", barH)
        .attr("fill", color)
        .attr("fill-opacity", 0.85)
        .attr("stroke", "#0B1733")
        .attr("stroke-width", 1);
      svg
        .append("text")
        .attr("x", x((a + c) / 2))
        .attr("y", barY + barH + 14)
        .attr("text-anchor", "middle")
        .attr("font-family", "'Source Code Pro', monospace")
        .attr("font-size", "8.5px")
        .attr("letter-spacing", "0.12em")
        .attr("fill", "#1E2F5C")
        .text(label);
    });

    // boundary ticks with bps values
    [0, drifting, atRisk, insolvent, 1000].forEach((v) => {
      svg
        .append("line")
        .attr("x1", x(v))
        .attr("x2", x(v))
        .attr("y1", barY - 5)
        .attr("y2", barY + barH)
        .attr("stroke", "#0B1733")
        .attr("stroke-width", 1);
      svg
        .append("text")
        .attr("x", x(v))
        .attr("y", barY - 9)
        .attr("text-anchor", "middle")
        .attr("font-family", "'Source Code Pro', monospace")
        .attr("font-size", "8px")
        .attr("fill", "#6b6353")
        .text(String(v));
    });

    // pointer
    const px = x(Math.max(0, Math.min(1000, risk)));
    const ptr = svg
      .append("g")
      .attr("opacity", 0)
      .attr("transform", `translate(${px},0)`);
    ptr
      .append("path")
      .attr("d", `M0,${barY - 7} l-6,-9 l12,0 Z`)
      .attr("fill", "#0B1733");
    ptr
      .append("line")
      .attr("y1", barY - 7)
      .attr("y2", barY + barH + 2)
      .attr("stroke", "#0B1733")
      .attr("stroke-width", 2);
    ptr
      .append("text")
      .attr("y", barY - 18)
      .attr("text-anchor", "middle")
      .attr("font-family", "'Source Code Pro', monospace")
      .attr("font-size", "11px")
      .attr("font-weight", "600")
      .attr("fill", "#0B1733")
      .text(risk + " bps");
    ptr.transition().duration(700).ease(d3.easeCubicOut).attr("opacity", 1);
  }, [risk, drifting, atRisk, insolvent]);

  return <svg ref={ref} viewBox="0 0 640 96" className="gauge" role="img" aria-label="risk gauge" />;
}

/* ─── Drift arrow between two rungs ───────────────────────────────────────── */
function DriftArrow({ prev, cur }: { prev: RungView; cur: RungView }) {
  const dRatio = cur.ratioBps - prev.ratioBps;
  const worse = dRatio < 0;
  const cls = worse ? "down" : dRatio > 0 ? "up" : "flat";
  const glyph = worse ? "▼" : dRatio > 0 ? "▲" : "▬";
  const pct = prev.ratioBps ? ((dRatio / prev.ratioBps) * 100).toFixed(1) : "0.0";
  return (
    <div className={`drift ${cls}`}>
      <span className="darrow">{glyph}</span>
      <span className="mono dlabel">
        Δratio {dRatio >= 0 ? "+" : ""}
        {pct}% · drift {cur.driftScoreBps} bps
        {cur.contradictsAudit ? " · CONTRADICTS AUDIT" : ""}
      </span>
    </div>
  );
}

export function App() {
  const { address, isConnected } = useAccount();
  const acct = address as Hex | undefined;

  const [counts, setCounts] = useState<CountsView | null>(null);
  const [consts, setConsts] = useState<ConstantsView | null>(null);
  const [dossiers, setDossiers] = useState<DossierRow[]>([]);
  const [selAccount, setSelAccount] = useState<number | null>(null);
  const [selSnapshot, setSelSnapshot] = useState<SnapshotView | null>(null);
  const [mine, setMine] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [loading, setLoading] = useState(false);

  // form state
  const [regName, setRegName] = useState("");
  const [snapAcct, setSnapAcct] = useState("");
  const [reserves, setReserves] = useState("");
  const [liabilities, setLiabilities] = useState("");
  const [auditUrl, setAuditUrl] = useState("");
  const [custodyUrl, setCustodyUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [scoreId, setScoreId] = useState("");
  const [lateId, setLateId] = useState("");
  const [newAdmin, setNewAdmin] = useState("");
  const [unfreezeId, setUnfreezeId] = useState("");

  const ladderRef = useRef<HTMLDivElement | null>(null);

  const flash = useCallback((m: string) => {
    setToast(m);
    window.setTimeout(() => setToast(""), 4200);
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [c, k, d] = await Promise.all([getCounts(), getConstants(), loadDossiers()]);
      setCounts(c);
      setConsts(k);
      setDossiers(d);
      setSelAccount((prev) => {
        if (prev !== null && d.some((x) => x.accountId === prev)) return prev;
        return d.length ? d[d.length - 1].accountId : null;
      });
    } catch (e: any) {
      flash("Read failed: " + (e?.message || String(e)));
    } finally {
      setLoading(false);
    }
  }, [flash]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    (async () => {
      if (!acct) {
        setMine([]);
        return;
      }
      try {
        setMine(await listAccountsOf(acct.toLowerCase()));
      } catch {
        setMine([]);
      }
    })();
  }, [acct, counts]);

  const selected = useMemo(
    () => dossiers.find((d) => d.accountId === selAccount) || null,
    [dossiers, selAccount],
  );

  // GSAP ScrollTrigger stagger reveal for ladder rungs.
  useEffect(() => {
    if (!ladderRef.current) return;
    const ctx = gsap.context(() => {
      const rungs = gsap.utils.toArray<HTMLElement>(".rung");
      if (!rungs.length) return;
      gsap.fromTo(
        rungs,
        { opacity: 0, y: 26, filter: "blur(2px)" },
        {
          opacity: 1,
          y: 0,
          filter: "blur(0px)",
          duration: 0.6,
          ease: "power2.out",
          stagger: 0.12,
          scrollTrigger: {
            trigger: ladderRef.current,
            start: "top 82%",
          },
        },
      );
      gsap.fromTo(
        ".drift",
        { opacity: 0 },
        {
          opacity: 1,
          duration: 0.5,
          stagger: 0.12,
          delay: 0.2,
          scrollTrigger: { trigger: ladderRef.current, start: "top 82%" },
        },
      );
    }, ladderRef);
    return () => ctx.revert();
  }, [selected?.accountId, selected?.ladder.length]);

  const guard = (): Hex | null => {
    if (!isConnected || !acct) {
      flash("Connect a wallet first.");
      return null;
    }
    return acct;
  };

  const run = async (label: string, fn: (a: Hex) => Promise<void>) => {
    const a = guard();
    if (!a) return;
    setBusy(true);
    flash(label + "…");
    try {
      await fn(a);
      flash(label + " — ACCEPTED");
      await refresh();
    } catch (e: any) {
      flash(label + " failed: " + (e?.message || String(e)));
    } finally {
      setBusy(false);
    }
  };

  const onRegister = () =>
    run("Register custodian", async (a) => {
      const id = await registerAccount(a, regName);
      setRegName("");
      setSnapAcct(String(id));
      setSelAccount(id);
    });

  const onSubmit = () =>
    run("Submit snapshot", async (a) => {
      const id = await submitSnapshot(
        a,
        Number(snapAcct),
        BigInt(reserves || "0"),
        BigInt(liabilities || "0"),
        auditUrl,
        custodyUrl,
        notes,
      );
      setScoreId(String(id));
    });

  const onScore = () =>
    run("Score snapshot", async (a) => {
      await scoreSnapshot(a, Number(scoreId));
    });

  const onLate = () =>
    run("Penalise late", async (a) => {
      await penaliseLate(a, Number(lateId));
    });

  const onAdvance = () =>
    run("Advance epoch", async (a) => {
      await advanceEpoch(a);
    });

  const onSetAdmin = () =>
    run("Set admin", async (a) => {
      await setAdmin(a, newAdmin);
      setNewAdmin("");
    });

  const onUnfreeze = () =>
    run("Unfreeze account", async (a) => {
      await unfreezeAccount(a, Number(unfreezeId));
    });

  const openSnapshot = async (id: number) => {
    try {
      setSelSnapshot(await getSnapshot(id));
      flash("Loaded snapshot #" + id);
    } catch (e: any) {
      flash("Snapshot read failed: " + (e?.message || String(e)));
    }
  };

  const ladder = selected?.ladder ?? [];

  return (
    <div className="filing">
      <div className="rule top" />

      {/* ── masthead ──────────────────────────────────────────────────────── */}
      <header className="sheet masthead">
        <div className="folio">
          <span className="pno">§00</span>
          <span className="ts mono">{stamp()}</span>
        </div>
        <div className="mast-top">
          <span className="kicker mono">ATTESTATION LEDGER</span>
          <ConnectButton showBalance={false} chainStatus="icon" />
        </div>
        <h1 className="title">RESERVE TRUTH</h1>
        <p className="standfirst">
          A periodic, adversarially-audited proof-of-reserves filing. Each custodian
          attests reserves against liabilities; consecutive attestations stack into a
          snapshot ladder; an LLM scores the drift and the contract maintains a
          deterministic risk score from <span className="mono">0</span> to{" "}
          <span className="mono">1000</span> basis points.
        </p>
        <dl className="colophon">
          <div>
            <dt>Custodian contract</dt>
            <dd className="mono break">{CONTRACT_ADDRESS}</dd>
          </div>
          <div>
            <dt>Filer wallet</dt>
            <dd className="mono break">
              {isConnected ? address : "— not connected —"}
            </dd>
          </div>
          <div>
            <dt>Network</dt>
            <dd className="mono">GenLayer Studionet · chain 61999</dd>
          </div>
        </dl>
      </header>

      {/* ── part I — registry of record ───────────────────────────────────── */}
      <section className="sheet">
        <div className="folio">
          <span className="pno">§01</span>
          <span className="ts mono">REGISTER</span>
        </div>
        <h2 className="part">Part I — Registry of Record</h2>
        <div className="ledgerline">
          <span>NEXT ACCOUNT ID</span>
          <b className="mono">{counts?.nextAccountId ?? "—"}</b>
        </div>
        <div className="ledgerline">
          <span>NEXT SNAPSHOT ID</span>
          <b className="mono">{counts?.nextSnapshotId ?? "—"}</b>
        </div>
        <div className="ledgerline">
          <span>SCORED ATTESTATIONS</span>
          <b className="mono">{counts?.scoredCount ?? "—"}</b>
        </div>
        <div className="ledgerline">
          <span>INSOLVENT EVENTS</span>
          <b className="mono">{counts?.insolventCount ?? "—"}</b>
        </div>
        <div className="ledgerline">
          <span>FROZEN ACCOUNTS</span>
          <b className="mono">{counts?.frozenCount ?? "—"}</b>
        </div>
        <div className="ledgerline">
          <span>CURRENT EPOCH</span>
          <b className="mono">{counts?.currentEpoch ?? "—"}</b>
        </div>

        <div className="form">
          <label htmlFor="reg">Register a new custodian account</label>
          <div className="inline">
            <input
              id="reg"
              value={regName}
              onChange={(e) => setRegName(e.target.value)}
              placeholder="Custodian legal name"
            />
            <button className="seal" disabled={busy || !regName.trim()} onClick={onRegister}>
              File
            </button>
          </div>
          {mine.length > 0 && (
            <p className="micro">
              Accounts filed by this wallet:{" "}
              {mine.map((m) => (
                <button key={m} className="ref" onClick={() => setSelAccount(m)}>
                  #{m}
                </button>
              ))}
            </p>
          )}
        </div>
      </section>

      {/* ── part II — the snapshot ladder ─────────────────────────────────── */}
      <section className="sheet">
        <div className="folio">
          <span className="pno">§02</span>
          <span className="ts mono">LADDER</span>
        </div>
        <h2 className="part">Part II — The Snapshot Ladder</h2>

        <div className="accbar">
          {dossiers.length === 0 && <span className="micro">No accounts on record yet.</span>}
          {dossiers.map((d) => (
            <button
              key={d.accountId}
              className={`tab ${d.accountId === selAccount ? "on" : ""}`}
              onClick={() => setSelAccount(d.accountId)}
            >
              <span className="mono">#{d.accountId}</span> {d.name || "—"}
              <i className={`dot ${verdictKey(d.verdict)}`} />
            </button>
          ))}
        </div>

        {selected ? (
          <>
            <div className="acchead">
              <div>
                <h3 className="accname">{selected.name || "Unnamed custodian"}</h3>
                <span className="mono break custodian">{selected.custodian}</span>
              </div>
              <span className={`verdict ${verdictKey(selected.verdict)}`}>
                {selected.verdict || "—"}
              </span>
            </div>

            {/* full account view fields */}
            <div className="kvgrid">
              <div className="kv"><span>account_id</span><b className="mono">{selected.accountId}</b></div>
              <div className="kv"><span>status</span><b className="mono">{ACCOUNT_STATUS[selected.status] ?? selected.status}</b></div>
              <div className="kv"><span>risk_score_bps</span><b className="mono">{selected.riskScoreBps}</b></div>
              <div className="kv"><span>verdict</span><b className="mono">{selected.verdict}</b></div>
              <div className="kv"><span>last_attest_epoch</span><b className="mono">{selected.lastAttestEpoch}</b></div>
              <div className="kv"><span>clean_streak</span><b className="mono">{selected.cleanStreak}</b></div>
              <div className="kv"><span>drift_streak</span><b className="mono">{selected.driftStreak}</b></div>
              <div className="kv"><span>last_ratio_bps</span><b className="mono">{selected.lastRatioBps} ({fmtRatio(selected.lastRatioBps)})</b></div>
              <div className="kv wide"><span>last_reserves_wei</span><b className="mono break">{fmtWei(selected.lastReservesWei)}</b></div>
              <div className="kv wide"><span>last_liabilities_wei</span><b className="mono break">{fmtWei(selected.lastLiabilitiesWei)}</b></div>
              <div className="kv wide"><span>snapshot_ids</span><b className="mono break">[{selected.snapshotIds.join(", ")}]</b></div>
            </div>

            <div className="ladder" ref={ladderRef}>
              <div className="rung head">
                <span className="r-ep">EPOCH</span>
                <span className="r-res">RESERVES (wei)</span>
                <span className="r-lia">LIABILITIES (wei)</span>
                <span className="r-rat">RATIO</span>
                <span className="r-dft">DRIFT</span>
              </div>
              {ladder.length === 0 && (
                <p className="micro">No attestations filed for this account yet.</p>
              )}
              {ladder.map((s, i) => (
                <div key={s.snapshotId}>
                  {i > 0 && <DriftArrow prev={ladder[i - 1]} cur={s} />}
                  <button
                    className={`rung ${SNAPSHOT_STATUS[s.status]?.toLowerCase() ?? ""} ${
                      s.contradictsAudit ? "flag" : ""
                    }`}
                    onClick={() => openSnapshot(s.snapshotId)}
                  >
                    <span className="r-ep mono">E{s.epoch}</span>
                    <span className="r-res mono">{fmtWei(s.reservesWei)}</span>
                    <span className="r-lia mono">{fmtWei(s.liabilitiesWei)}</span>
                    <span className="r-rat mono">{fmtRatio(s.ratioBps)}</span>
                    <span className="r-dft mono">{s.driftScoreBps}</span>
                    <span className="r-id mono">#{s.snapshotId}</span>
                  </button>
                </div>
              ))}
            </div>
          </>
        ) : (
          <p className="micro">{loading ? "Loading filings…" : "Select or register an account."}</p>
        )}
      </section>

      {/* ── part III — snapshot detail ────────────────────────────────────── */}
      {selSnapshot && (
        <section className="sheet">
          <div className="folio">
            <span className="pno">§03</span>
            <span className="ts mono">EXHIBIT</span>
          </div>
          <h2 className="part">
            Part III — Attestation Exhibit #{selSnapshot.snapshotId}
          </h2>
          <div className="kvgrid">
            <div className="kv"><span>snapshot_id</span><b className="mono">{selSnapshot.snapshotId}</b></div>
            <div className="kv"><span>account_id</span><b className="mono">{selSnapshot.accountId}</b></div>
            <div className="kv"><span>epoch</span><b className="mono">{selSnapshot.epoch}</b></div>
            <div className="kv"><span>status</span><b className="mono">{SNAPSHOT_STATUS[selSnapshot.status] ?? selSnapshot.status}</b></div>
            <div className="kv"><span>drift_score_bps</span><b className="mono">{selSnapshot.driftScoreBps}</b></div>
            <div className="kv"><span>contradicts_audit</span><b className={`mono ${selSnapshot.contradictsAudit ? "danger" : ""}`}>{String(selSnapshot.contradictsAudit)}</b></div>
            <div className="kv wide"><span>reserves_wei</span><b className="mono break">{fmtWei(selSnapshot.reservesWei)}</b></div>
            <div className="kv wide"><span>liabilities_wei</span><b className="mono break">{fmtWei(selSnapshot.liabilitiesWei)}</b></div>
            <div className="kv wide"><span>audit_url</span><b className="mono break"><a href={selSnapshot.auditUrl} target="_blank" rel="noreferrer">{selSnapshot.auditUrl || "—"}</a></b></div>
            <div className="kv wide"><span>custody_url</span><b className="mono break"><a href={selSnapshot.custodyUrl} target="_blank" rel="noreferrer">{selSnapshot.custodyUrl || "—"}</a></b></div>
          </div>
          {selSnapshot.notes && (
            <p className="prose"><span className="lbl">NOTES</span>{selSnapshot.notes}</p>
          )}
          <p className="prose"><span className="lbl">LLM RATIONALE</span>{selSnapshot.rationale || "— not yet scored —"}</p>
          <button className="ref" onClick={() => setSelSnapshot(null)}>close exhibit</button>
        </section>
      )}

      {/* ── part IV — filing controls ─────────────────────────────────────── */}
      <section className="sheet">
        <div className="folio">
          <span className="pno">§04</span>
          <span className="ts mono">FILE</span>
        </div>
        <h2 className="part">Part IV — Filing Controls</h2>

        <div className="control">
          <h4>Submit attestation snapshot</h4>
          <div className="grid2">
            <div>
              <label>account_id</label>
              <input value={snapAcct} onChange={(e) => setSnapAcct(e.target.value)} placeholder="0" />
            </div>
            <div>
              <label>reserves_wei</label>
              <input value={reserves} onChange={(e) => setReserves(e.target.value)} placeholder="1050000000000000000000" />
            </div>
            <div>
              <label>liabilities_wei</label>
              <input value={liabilities} onChange={(e) => setLiabilities(e.target.value)} placeholder="1000000000000000000000" />
            </div>
            <div>
              <label>audit_url</label>
              <input value={auditUrl} onChange={(e) => setAuditUrl(e.target.value)} placeholder="https://…/audit.json" />
            </div>
            <div>
              <label>custody_url</label>
              <input value={custodyUrl} onChange={(e) => setCustodyUrl(e.target.value)} placeholder="https://…/custody.json" />
            </div>
            <div className="span2">
              <label>notes</label>
              <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="optional disclosure notes" />
            </div>
          </div>
          <button className="seal" disabled={busy || !snapAcct} onClick={onSubmit}>
            File snapshot
          </button>
        </div>

        <div className="control">
          <h4>Score a snapshot (LLM drift audit)</h4>
          <div className="inline">
            <input value={scoreId} onChange={(e) => setScoreId(e.target.value)} placeholder="snapshot_id" />
            <button className="seal" disabled={busy || scoreId === ""} onClick={onScore}>Score</button>
          </div>
        </div>

        <div className="control">
          <h4>Penalise a late custodian</h4>
          <div className="inline">
            <input value={lateId} onChange={(e) => setLateId(e.target.value)} placeholder="account_id" />
            <button className="seal alt" disabled={busy || lateId === ""} onClick={onLate}>Penalise</button>
          </div>
        </div>

        <div className="control admin">
          <h4>Keeper / Admin</h4>
          <div className="inline">
            <button className="ghost" disabled={busy} onClick={onAdvance}>advance_epoch →</button>
          </div>
          <div className="inline">
            <input value={unfreezeId} onChange={(e) => setUnfreezeId(e.target.value)} placeholder="account_id to unfreeze" />
            <button className="ghost" disabled={busy || unfreezeId === ""} onClick={onUnfreeze}>unfreeze_account</button>
          </div>
          <div className="inline">
            <input value={newAdmin} onChange={(e) => setNewAdmin(e.target.value)} placeholder="0x… new admin address" />
            <button className="ghost" disabled={busy || !newAdmin.trim()} onClick={onSetAdmin}>set_admin</button>
          </div>
        </div>
      </section>

      {/* ── part V — risk gauge ──────────────────────────────────────────── */}
      <section className="sheet">
        <div className="folio">
          <span className="pno">§05</span>
          <span className="ts mono">RISK</span>
        </div>
        <h2 className="part">Part V — Solvency Risk Gauge</h2>
        <p className="standfirst sm">
          {selected
            ? `Account #${selected.accountId} — ${selected.name || "unnamed"} — current verdict ${selected.verdict || "—"}.`
            : "Select an account to plot its risk."}
        </p>
        <RiskGauge risk={selected?.riskScoreBps ?? 0} consts={consts} />
        <div className="vlegend">
          {VERDICTS.map((v) => (
            <span key={v} className={`vchip ${verdictKey(v)}`}>{v}</span>
          ))}
        </div>
      </section>

      {/* ── part VI — protocol constants ─────────────────────────────────── */}
      <section className="sheet">
        <div className="folio">
          <span className="pno">§06</span>
          <span className="ts mono">SCHEDULE</span>
        </div>
        <h2 className="part">Part VI — Schedule of Protocol Constants</h2>
        {consts ? (
          <div className="kvgrid consts">
            {Object.entries(consts).map(([k, v]) => (
              <div className="kv" key={k}>
                <span>{k}</span>
                <b className="mono">{String(v)}</b>
              </div>
            ))}
          </div>
        ) : (
          <p className="micro">Loading schedule…</p>
        )}
      </section>

      <footer className="sheet foot">
        <div className="rule" />
        <p className="micro">
          RESERVE TRUTH · attestation ledger · GenLayer Studionet ·{" "}
          <span className="mono">{CONTRACT_ADDRESS}</span>
        </p>
      </footer>

      {toast && <div className="toast mono">{toast}</div>}
    </div>
  );
}

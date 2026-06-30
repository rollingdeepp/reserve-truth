import { createClient, createAccount } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { TransactionStatus } from "genlayer-js/types";
import { CONTRACT_ADDRESS } from "./chain";

type Hex = `0x${string}`;
const TIMEOUT_MS = 240_000;

// ─── Status / verdict enums (mirror reserve-truth.py) ────────────────────────
export const ACCOUNT_STATUS = ["REGISTERED", "ACTIVE", "LATE", "FROZEN"] as const;
export const SNAPSHOT_STATUS = ["PENDING", "SCORED", "DISPUTED"] as const;
export type Verdict = "HEALTHY" | "DRIFTING" | "AT_RISK" | "INSOLVENT" | "";

// ─── View shapes ─────────────────────────────────────────────────────────────
export interface AccountView {
  accountId: number;
  custodian: string;
  name: string;
  status: number;
  riskScoreBps: number;
  verdict: Verdict;
  snapshotIds: number[];
  lastAttestEpoch: number;
  cleanStreak: number;
  driftStreak: number;
  lastRatioBps: number;
  lastReservesWei: string;
  lastLiabilitiesWei: string;
}

export interface SnapshotView {
  snapshotId: number;
  accountId: number;
  epoch: number;
  reservesWei: string;
  liabilitiesWei: string;
  auditUrl: string;
  custodyUrl: string;
  notes: string;
  status: number;
  driftScoreBps: number;
  contradictsAudit: boolean;
  rationale: string;
}

export interface RungView {
  snapshotId: number;
  epoch: number;
  reservesWei: string;
  liabilitiesWei: string;
  ratioBps: number;
  driftScoreBps: number;
  contradictsAudit: boolean;
  status: number;
}

export interface CountsView {
  nextAccountId: number;
  nextSnapshotId: number;
  scoredCount: number;
  insolventCount: number;
  frozenCount: number;
  currentEpoch: number;
}

export interface ConstantsView {
  RISK_MAX: number;
  DRIFT_SCORE_MAX: number;
  DRIFT_TOL: number;
  INSOLVENT_FLOOR: number;
  AT_RISK_FLOOR: number;
  DRIFTING_FLOOR: number;
  ATTESTATION_PERIOD: number;
  LATE_GRACE: number;
  RATIO_HEALTHY_FLOOR_BPS: number;
  RATIO_DRIFT_FLOOR_BPS: number;
  RISK_DECAY_LATE: number;
  RISK_RECOVER_CLEAN: number;
}

export interface ScoreResult {
  snapshotId: number;
  accountId: number;
  driftScoreBps: number;
  ratioBps: number;
  contradictsAudit: boolean;
  newRiskBps: number;
  verdict: Verdict;
}

export interface LateResult {
  accountId: number;
  epochsLate: number;
  newRiskBps: number;
  verdict: Verdict;
}

// ─── Clients ─────────────────────────────────────────────────────────────────
function readClient() {
  return createClient({ chain: studionet, account: createAccount() });
}
function writeClient(account: Hex) {
  return createClient({ chain: studionet, account });
}

async function waitAccepted(client: any, hash: Hex) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("Transaction timed out")), TIMEOUT_MS);
  });
  try {
    await Promise.race([
      client.waitForTransactionReceipt({
        hash: hash as never,
        status: TransactionStatus.ACCEPTED,
        interval: 5000,
        retries: 64,
      }),
      timeout,
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// Defensive accessor: object key OR positional array index.
function pick(obj: any, key: string, idx: number): any {
  if (obj == null) return undefined;
  if (Array.isArray(obj)) return obj[idx];
  if (typeof obj === "object" && key in obj) return obj[key];
  return undefined;
}

const s = (v: any, d = "") => (v === undefined || v === null ? d : String(v));
const n = (v: any, d = 0) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : d;
};
const b = (v: any) => v === true || v === "true" || v === 1 || v === "1";

// ─── Decoders ────────────────────────────────────────────────────────────────
function decodeAccount(r: any): AccountView {
  const ids = pick(r, "snapshot_ids", 6);
  return {
    accountId: n(pick(r, "account_id", 0)),
    custodian: s(pick(r, "custodian", 1)),
    name: s(pick(r, "name", 2)),
    status: n(pick(r, "status", 3)),
    riskScoreBps: n(pick(r, "risk_score_bps", 4)),
    verdict: s(pick(r, "verdict", 5)) as Verdict,
    snapshotIds: Array.isArray(ids) ? ids.map((x: any) => n(x)) : [],
    lastAttestEpoch: n(pick(r, "last_attest_epoch", 7)),
    cleanStreak: n(pick(r, "clean_streak", 8)),
    driftStreak: n(pick(r, "drift_streak", 9)),
    lastRatioBps: n(pick(r, "last_ratio_bps", 10)),
    lastReservesWei: s(pick(r, "last_reserves_wei", 11), "0"),
    lastLiabilitiesWei: s(pick(r, "last_liabilities_wei", 12), "0"),
  };
}

function decodeSnapshot(r: any): SnapshotView {
  return {
    snapshotId: n(pick(r, "snapshot_id", 0)),
    accountId: n(pick(r, "account_id", 1)),
    epoch: n(pick(r, "epoch", 2)),
    reservesWei: s(pick(r, "reserves_wei", 3), "0"),
    liabilitiesWei: s(pick(r, "liabilities_wei", 4), "0"),
    auditUrl: s(pick(r, "audit_url", 5)),
    custodyUrl: s(pick(r, "custody_url", 6)),
    notes: s(pick(r, "notes", 7)),
    status: n(pick(r, "status", 8)),
    driftScoreBps: n(pick(r, "drift_score_bps", 9)),
    contradictsAudit: b(pick(r, "contradicts_audit", 10)),
    rationale: s(pick(r, "rationale", 11)),
  };
}

function decodeRung(r: any): RungView {
  return {
    snapshotId: n(pick(r, "snapshot_id", 0)),
    epoch: n(pick(r, "epoch", 1)),
    reservesWei: s(pick(r, "reserves_wei", 2), "0"),
    liabilitiesWei: s(pick(r, "liabilities_wei", 3), "0"),
    ratioBps: n(pick(r, "ratio_bps", 4)),
    driftScoreBps: n(pick(r, "drift_score_bps", 5)),
    contradictsAudit: b(pick(r, "contradicts_audit", 6)),
    status: n(pick(r, "status", 7)),
  };
}

async function read(functionName: string, args: any[]): Promise<any> {
  return readClient().readContract({
    address: CONTRACT_ADDRESS as Hex,
    functionName,
    args,
  });
}

async function write(account: Hex, functionName: string, args: any[]): Promise<Hex> {
  const wc = writeClient(account);
  const h = (await wc.writeContract({
    address: CONTRACT_ADDRESS as Hex,
    functionName,
    args,
    value: 0n,
  })) as Hex;
  await waitAccepted(wc, h);
  return h;
}

// ════════════════════════════ WRITES ════════════════════════════════════════
export async function registerAccount(account: Hex, name: string): Promise<number> {
  await write(account, "register_account", [name.trim()]);
  const c = await getCounts();
  return c.nextAccountId - 1;
}

export async function submitSnapshot(
  account: Hex,
  accountId: number,
  reservesWei: bigint,
  liabilitiesWei: bigint,
  auditUrl: string,
  custodyUrl: string,
  notes: string,
): Promise<number> {
  await write(account, "submit_snapshot", [
    accountId,
    reservesWei,
    liabilitiesWei,
    auditUrl.trim(),
    custodyUrl.trim(),
    notes.trim(),
  ]);
  const c = await getCounts();
  return c.nextSnapshotId - 1;
}

export async function scoreSnapshot(account: Hex, snapshotId: number): Promise<void> {
  await write(account, "score_snapshot", [snapshotId]);
}

export async function penaliseLate(account: Hex, accountId: number): Promise<void> {
  await write(account, "penalise_late", [accountId]);
}

export async function advanceEpoch(account: Hex): Promise<void> {
  await write(account, "advance_epoch", []);
}

export async function setAdmin(account: Hex, newAdmin: string): Promise<void> {
  await write(account, "set_admin", [newAdmin.trim()]);
}

export async function unfreezeAccount(account: Hex, accountId: number): Promise<void> {
  await write(account, "unfreeze_account", [accountId]);
}

// ════════════════════════════ VIEWS ═════════════════════════════════════════
export async function getAccount(accountId: number): Promise<AccountView> {
  return decodeAccount(await read("get_account", [accountId]));
}

export async function getSnapshot(snapshotId: number): Promise<SnapshotView> {
  return decodeSnapshot(await read("get_snapshot", [snapshotId]));
}

export async function getLadder(accountId: number): Promise<RungView[]> {
  const r: any = await read("get_ladder", [accountId]);
  return Array.isArray(r) ? r.map(decodeRung) : [];
}

export async function listAccounts(): Promise<number[]> {
  const r: any = await read("list_accounts", []);
  return Array.isArray(r) ? r.map((x: any) => n(x)) : [];
}

export async function listAccountsOf(custodianHex: string): Promise<number[]> {
  const r: any = await read("list_accounts_of", [custodianHex]);
  return Array.isArray(r) ? r.map((x: any) => n(x)) : [];
}

export async function getCounts(): Promise<CountsView> {
  const r: any = await read("get_counts", []);
  const p = String(r).split("||").map((x) => Number(x) || 0);
  return {
    nextAccountId: p[0] || 0,
    nextSnapshotId: p[1] || 0,
    scoredCount: p[2] || 0,
    insolventCount: p[3] || 0,
    frozenCount: p[4] || 0,
    currentEpoch: p[5] || 0,
  };
}

export async function getConstants(): Promise<ConstantsView> {
  const r: any = await read("get_constants", []);
  const g = (k: string, i: number) => n(pick(r, k, i));
  return {
    RISK_MAX: g("RISK_MAX", 0),
    DRIFT_SCORE_MAX: g("DRIFT_SCORE_MAX", 1),
    DRIFT_TOL: g("DRIFT_TOL", 2),
    INSOLVENT_FLOOR: g("INSOLVENT_FLOOR", 3),
    AT_RISK_FLOOR: g("AT_RISK_FLOOR", 4),
    DRIFTING_FLOOR: g("DRIFTING_FLOOR", 5),
    ATTESTATION_PERIOD: g("ATTESTATION_PERIOD", 6),
    LATE_GRACE: g("LATE_GRACE", 7),
    RATIO_HEALTHY_FLOOR_BPS: g("RATIO_HEALTHY_FLOOR_BPS", 8),
    RATIO_DRIFT_FLOOR_BPS: g("RATIO_DRIFT_FLOOR_BPS", 9),
    RISK_DECAY_LATE: g("RISK_DECAY_LATE", 10),
    RISK_RECOVER_CLEAN: g("RISK_RECOVER_CLEAN", 11),
  };
}

// Aggregate every account + its full ladder for the filing view.
export interface DossierRow extends AccountView {
  ladder: RungView[];
}

export async function loadDossiers(maxAccounts = 64): Promise<DossierRow[]> {
  const ids = await listAccounts();
  if (!ids.length) return [];
  const tail = ids.slice(-maxAccounts);
  const rows = await Promise.all(
    tail.map(async (id) => {
      try {
        const acc = await getAccount(id);
        const ladder = await getLadder(id);
        return { ...acc, ladder };
      } catch {
        return null;
      }
    }),
  );
  return rows.filter((r): r is DossierRow => r !== null);
}

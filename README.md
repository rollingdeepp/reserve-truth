# Reserve Truth

Reserve coverage attestation ledger on GenLayer.

- **App**: https://rollingdeepp.github.io/reserve-truth/
- **Network**: GenLayer Studionet
- **Contract**: `0xFf03D132C628E5d66101915Bd77a4641416c699F`

## Overview

The contract logic runs fully on-chain. A decentralised panel of GenLayer validators reads the submitted evidence, reaches consensus on the outcome, and stores the result on-chain so it cannot be quietly changed after the fact.

## Structure

- `backend/` - GenLayer smart contract (reserve-truth.py)
- `frontend/` - React + TypeScript + Vite web application

## Develop

```bash
cd frontend
npm install
npm run dev      # http://localhost:5380
```

## Build

```bash
cd frontend
npm run build    # static output in dist/
```

## Deploy

This project is automatically deployed to GitHub Pages via GitHub Actions on every push to main.

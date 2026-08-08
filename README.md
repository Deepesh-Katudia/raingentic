# FLOAT

An AI agent that earns its own money onchain and holds a real credit card whose
limit tracks its live earnings.

The agent sells product price lookups to other shopping agents. They pay $0.05
per query over x402 on Monad testnet. Every payment is recorded onchain as a
receipt. An underwriter reads those receipts continuously and issues a Rain
scoped virtual card whose limit equals what the agent has provably earned.

When a card authorization arrives, solvency is checked against onchain-derived
state **inside the ~2 second authorization window**. That is the point: at 15
second finality this is impossible, not merely slow.

Design spec: [`docs/superpowers/specs/2026-08-08-float-design.md`](docs/superpowers/specs/2026-08-08-float-design.md)

## Setup

```bash
pnpm install
cp .env.example .env      # then fill in the values below
```

Required before anything touches the chain:

| Variable | What it needs to be |
|---|---|
| `MONAD_RPC_URL` | Working Monad testnet RPC |
| `SELLER_PRIVATE_KEY` / `SELLER_ADDRESS` | Funded with MON for gas |
| `BUYER_PRIVATE_KEYS` | 3 comma-separated keys, each funded with **testnet USDC** (`0x534b2f3A21130d7a60830c2Df862319e593943A3`) and a little MON |
| `CREDIT_FILE_ADDRESS` | Filled in by `pnpm contracts:deploy` |

## Build order

Each step has a binary pass/fail. Do not skip ahead.

```bash
# M0  — everything boots
pnpm dev

# M0.5 — one paid call settles through the Monad facilitator (needs funded buyer)
pnpm -F @float/seller-agent dev     # in one terminal
pnpm smoke:x402                     # in another

# M1  — contract live on Monad testnet
pnpm contracts:build
pnpm contracts:deploy               # paste CREDIT_FILE_ADDRESS into .env
pnpm contracts:test

# M2  — receipts landing onchain at demo rate
pnpm dev
curl -X POST localhost:3002/control/start

# M3/M4 — limit tracks earnings, card scope follows, auths decide
pnpm -F @float/underwriter test
```

## Running the demo

```bash
pnpm dev                                    # all four services
open http://localhost:5173                  # dashboard
curl -X POST localhost:3003/api/demo/income/start
# ... limit climbs, authorizations approve ...
curl -X POST localhost:3003/api/demo/income/stop
# ... limit decays, next authorization declines ...
```

## Services

| Service | Port | Role |
|---|---|---|
| seller-agent | 3001 | x402-gated `/price`, writes batched receipts onchain |
| buyer-agents | 3002 | income faucet, `POST /control/{start,stop}` |
| underwriter | 3003 | chain watcher, limit engine, Rain sync, auth decisions, SSE |
| dashboard | 5173 | projector view |

## Notes

- **Money is always `bigint` micro-USD.** USDC on Monad has 6 decimals, so one
  USDC base unit is exactly one micro-USD. No conversion happens anywhere; the
  amount the facilitator moves is the integer recorded onchain. Floats appear
  only in `usd()` at the UI edge.
- **The auth path never awaits I/O.** It reads the in-memory profile the watcher
  keeps fresh at 500ms. Measured decisions land around 0.03ms against an 800ms
  hard deadline, and the deadline declines rather than hangs.
- **`RAIN_MODE=mock` is a supported way to run the whole demo.** The mock is the
  fallback, not scaffolding — if Rain is unavailable, flip back to it and the
  full earn → limit → approve → decline loop still works.
- **No database.** Underwriter memory plus the chain is the entire state.

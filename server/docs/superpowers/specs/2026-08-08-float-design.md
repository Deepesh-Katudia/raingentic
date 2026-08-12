# FLOAT — Design Spec

**Date:** 2026-08-08
**Status:** Approved, building
**Source:** Derived from the FLOAT implementation spec, amended by toolchain verification and environment constraints.

---

## 1. What we are building

An AI agent that earns its own money onchain and holds a real credit card whose limit tracks its live earnings.

The agent sells product price lookups to other shopping agents. They pay $0.05 per query over x402 on Monad testnet. Every payment is recorded onchain as a receipt. An underwriter reads those receipts continuously and issues a Rain scoped virtual card whose limit equals what the agent has provably earned.

When a card authorization arrives, solvency is checked against onchain-derived state inside the ~2 second auth window. That is the point of the project: at 15 second finality this is impossible, not merely slow.

### Demo outcomes (non-negotiable)

1. Card declines at $0 earned.
2. Earnings stream in, limit visibly climbs.
3. A real card authorization succeeds.
4. Income is cut, limit decays, next purchase declines.

---

## 2. Stack

| Concern | Choice |
|---|---|
| Language | TypeScript, Node 22, ESM |
| Monorepo | pnpm workspaces |
| Servers | Express |
| Chain | Monad testnet, viem |
| Contract | Solidity 0.8.24, compiled with `solc` (npm), deployed with viem |
| Payments (machine) | x402 v2 — `@x402/core`, `@x402/evm`, `@x402/express`, `@x402/fetch` |
| Payments (real world) | Rain API behind an adapter interface |
| Dashboard | Vite + React + Tailwind, live via SSE |
| Persistence | None. In-memory plus chain. |

### Verified chain and protocol values

Confirmed against `https://docs.monad.xyz/guides/x402` and the npm registry on 2026-08-08:

- Network identifier: `eip155:10143` (CAIP-2)
- Facilitator: `https://x402-facilitator.molandak.org`
- Settlement asset: USDC on Monad testnet, `0x534b2f3A21130d7a60830c2Df862319e593943A3`, **6 decimals**
- x402 packages: `@x402/*` at `2.21.0`

---

## 3. Amendments to the original spec

These are the only deviations. Each is forced by verification or environment, not preference.

### 3.1 x402 v2 packages, not v1

The original spec named `x402-express` and `x402-fetch`. Those are the v1 line, last published April 2026. Monad's facilitator uses CAIP-2 network identifiers (`eip155:10143`), which is a v2 concept. We use the `@x402/*` v2.21.0 scoped packages. `@x402/express` exists, so Express remains viable.

### 3.2 Money units require no conversion

USDC on Monad has 6 decimals. Therefore **1 USDC base unit is exactly 1 micro-USD**. The project's `bigint` micro-USD unit is the settlement unit. No conversion occurs anywhere — not at the x402 boundary, not at the contract boundary, not in the limit engine. Formatting to a decimal string happens only in the dashboard.

`PRICE_PER_CALL_MICRO=50000` is literally the amount the facilitator moves.

### 3.3 Contracts built with solc-js and viem, not Foundry

Foundry is not installed on the build machine and installing it (native Windows or via WSL) is a poor use of hours on a same-day build. `CreditFile.sol` source is unchanged. A Node compile script, a Node deploy script, and one Node test replace `forge build` / `forge test` / `forge create`.

### 3.4 Receipt batching

**Problem:** the configured demo rate is `BUYER_COUNT=3 × CALLS_PER_SEC_PER_BUYER=3` = 9 receipts/sec. A 3-minute demo is roughly 1600 individual transactions from a single EOA. The original spec's nonce serializer keeps those ordered but does not reduce the count, and sustained 9 tx/sec from one wallet is the riskiest unexamined assumption in the plan.

**Fix:** add `recordReceiptBatch(address[] payers, uint64[] amountsMicro)`. The seller enqueues receipts and a flusher drains the queue every 500ms into one transaction. This takes 9 tx/sec down to ~2 tx/sec and shrinks the nonce-race surface.

The single-receipt `recordReceipt` remains for the M1 smoke test.

### 3.5 Receipt scan cap raised to 2000

**Problem:** the original spec capped `getProfile`'s scan at the last 500 receipts. At 9 receipts/sec over a 120-second window there are ~1080 receipts in the window. The cap truncates to roughly the last 55 seconds, while the limit formula still divides by `EARNINGS_WINDOW_SECS=120`. The projected limit comes out about half of what it should be, and the effective decay window is silently 55s rather than 120s. This fails quietly — the demo still rises and falls, just with wrong numbers.

**Fix:** cap at 2000. With batching (3.4) the receipt array grows at the same rate but transactions do not, so the view call stays affordable.

**Contingency:** if `eth_call` on `getProfile` becomes slow, move aggregation off-chain by consuming `ReceiptRecorded` events in the underwriter and leaving the contract as a dumb event log. This is cut-list item 4 in the original spec and is already sanctioned.

### 3.6 Rain: mock first, live probe early

The original spec deferred `LiveRainClient` to M6 because credentials were not expected until Saturday. Credentials are in hand now. Unknown API shape is the largest remaining schedule risk, so:

1. Build `RainClient` interface and `MockRainClient` first. This is the permanent demo fallback and must keep working all day.
2. Immediately after the auth endpoint works against the mock, spike `LiveRainClient` to learn the real authorization webhook payload shape.
3. Expose the webhook publicly with ngrok or cloudflared.

Client selection happens in exactly one place, driven by `RAIN_MODE`.

### 3.7 Webhook HMAC verification

The authorization endpoint is publicly reachable through a tunnel and it mutates credit state. It verifies the `RAIN_WEBHOOK_SECRET` HMAC. This is roughly five lines; the alternative is an open endpoint that anyone can drive.

This is the only piece of security or error handling built outside the demo path.

### 3.8 Repo rooted at the project directory

Built directly in `E:\PROJECTS\raingentic`, not a nested `float/`.

---

## 4. Architecture

Four processes and one contract. No database. The underwriter's memory plus the chain is the entire state of the system.

```
buyer-agents ──x402 pay──> seller-agent ──recordReceiptBatch──> CreditFile (Monad)
  :3002 ctrl                  :3001                                    │
                                                                  poll + logs
                                                                       ▼
dashboard  <──SSE──  underwriter :3003  ──scope sync──> Rain
  :5173                    ▲
                           └── POST /webhooks/rain/authorization  (ngrok)
```

| Process | Port | Role |
|---|---|---|
| seller-agent | 3001 | x402-gated revenue endpoint |
| buyer-agents | 3002 | income faucet, start/stop control |
| underwriter | 3003 | chain watcher, limit engine, Rain sync, auth decisions, SSE |
| dashboard | 5173 | projector view |

### 4.1 Repo layout

```
raingentic/
├── packages/
│   ├── contracts/          # CreditFile.sol + compile/deploy/test scripts
│   └── shared/             # types.ts, money.ts, config.ts
├── apps/
│   ├── seller-agent/
│   ├── buyer-agents/
│   ├── underwriter/
│   └── dashboard/
├── docs/superpowers/specs/
├── .env.example
└── package.json
```

---

## 5. Components

### 5.1 packages/shared

- `money.ts` — `bigint` micro-USD helpers. `toMicro`, `formatUsd`. Formatting only, never parsing floats into money.
- `types.ts` — `Receipt`, `Profile`, `LimitState`, `AuthRequest`, `AuthDecision`, `StreamEvent`.
- `config.ts` — env parsing with fail-fast validation at startup. Missing required vars kill the process with a named error.

### 5.2 packages/contracts — CreditFile.sol

Append-only earnings ledger. Deliberately dumb. Not a DeFi protocol. No access control, no upgradeability, no ownership.

```solidity
struct Receipt {
    address payer;
    uint64  amountMicro;
    uint64  timestamp;
}

mapping(address => Receipt[]) public receipts;
mapping(address => uint256)   public totalEarnedMicro;

event ReceiptRecorded(
    address indexed agent,
    address indexed payer,
    uint64 amountMicro,
    uint64 timestamp
);

function recordReceipt(address payer, uint64 amountMicro) external;
function recordReceiptBatch(address[] calldata payers, uint64[] calldata amountsMicro) external;
function getReceipts(address agent, uint64 sinceTs) external view returns (Receipt[] memory);
function getProfile(address agent, uint64 windowSecs) external view returns (
    uint64 earnedInWindowMicro,
    uint32 distinctPayers,
    uint64 totalEarnedMicro
);
```

`msg.sender` is the earning agent. `getProfile` scans backwards, capped at 2000 receipts.

**Test (the one contract test):** record three receipts from two payers; assert `getProfile` returns correct window earnings and `distinctPayers == 2`.

### 5.3 apps/seller-agent

Express. One x402-gated route.

```
GET /price?sku=<string>
  → 402 Payment Required (x402 challenge)
  → on payment: 200 { sku, best: { store, priceMicro }, checked: [...] }
```

- `@x402/express` middleware on `/price`, priced at `PRICE_PER_CALL_MICRO`, facilitator set to Monad's, `payTo` = `SELLER_ADDRESS`, network `eip155:10143`.
- Handler returns hardcoded fixture data for ~10 SKUs across 5 fake stores, with ±3% jitter per call. **No scraper.** Nobody is judging the scraper.
- After the middleware confirms payment, the payer and amount are pushed to the receipt queue. The HTTP response never awaits the chain.
- A flusher drains the queue every 500ms into one `recordReceiptBatch`. All writes serialize through a single async queue with a nonce manager. Non-optional.
- Every sale logs one line: `SALE payer=0x.. amount=50000`.

### 5.4 apps/buyer-agents

Spawns `BUYER_COUNT` concurrent loops. Each picks a random SKU, calls `/price` via `@x402/fetch` with its own funded wallet, sleeps `1000 / CALLS_PER_SEC_PER_BUYER` ms, repeats.

Control server on :3002 exposes `POST /control/start` and `POST /control/stop` so income can be cut on cue.

### 5.5 apps/underwriter

The core service. Everything else feeds it.

**Chain watcher.** Polls `getProfile(SELLER_ADDRESS, EARNINGS_WINDOW_SECS)` every 500ms. Also subscribes to `ReceiptRecorded` logs for instant UI ticks. Latest profile held in memory.

**Limit engine.** Recomputed on every profile change:

```ts
const projectedMicro =
  (earnedInWindowMicro * BigInt(HORIZON_SECS)) / BigInt(EARNINGS_WINDOW_SECS);

const diversity = Math.min(distinctPayers, 5) / 5;
const adjusted  = projectedMicro * BigInt(Math.round((0.5 + 0.5 * diversity) * 100)) / 100n;

const limitMicro     = adjusted < CAP_MICRO ? adjusted : CAP_MICRO;
const availableMicro = limitMicro > outstandingMicro ? limitMicro - outstandingMicro : 0n;
```

Decay is free — the trailing window empties itself when income stops. No separate decay logic.

**Rain sync.** When `availableMicro` moves by more than `SYNC_THRESHOLD_MICRO`, push new scope to Rain. Debounced to at most one call per 2s.

**Auth decision endpoint — the critical path.**

```
POST /webhooks/rain/authorization
body: { authId, amountMicro, merchantId, mcc }
→ 200 { approved: boolean, reason: string }
```

Must complete in under 800ms. It:

1. Verifies the HMAC signature.
2. Reads the in-memory profile. **Never makes a blocking RPC or Rain call.**
3. `approved = amountMicro <= availableMicro && merchantAllowed(merchantId)`
4. On approval, adds to `outstandingMicro` immediately.
5. Logs the decision with elapsed ms.
6. Pushes the event to SSE.

A hard 800ms timer declines on expiry. A timeout that declines is correct; a hang is a failed demo.

**Test (the one auth test):** approves below the limit, declines above it.

**Dashboard API.**

```
GET  /api/state                      → full snapshot
GET  /api/stream                     → SSE: receipt | limit | auth | log
POST /api/demo/reset
POST /api/demo/income/{start|stop}   → proxies to buyer-agents control
```

**State ownership.** The underwriter is the single writer for `latestProfile`, `outstandingMicro`, `cardId`, and a 12-event ring buffer. Everything else is stateless.

### 5.6 Rain adapter

```ts
export interface CardScope {
  limitMicro: bigint;
  allowedMerchants: string[];
  allowedMccs: string[];
  expiresAt: Date;
}

export interface RainClient {
  issueCard(scope: CardScope): Promise<{ cardId: string; last4: string }>;
  updateScope(cardId: string, scope: CardScope): Promise<void>;
  getCard(cardId: string): Promise<{ cardId: string; last4: string; limitMicro: bigint }>;
}
```

- `MockRainClient` — in-memory, logs every call, fires a synthetic authorization every N seconds so the full loop is testable with zero credentials. Built first. Must remain working all day as the demo fallback.
- `LiveRainClient` — real HTTP, selected by `RAIN_MODE=live`.

Selection happens in exactly one place.

### 5.7 apps/dashboard

One screen, readable from 15 feet on a projector. Dark background, huge numbers, no scrolling. Four regions:

1. **EARNED** — total, counting up, monospace, largest element on screen.
2. **CREDIT LIMIT** — big number plus horizontal gauge. Green rising, red decaying. ~300ms transitions.
3. **LIVE FEED** — last 12 events, newest first. Receipts grey, authorizations green (APPROVED) or red (DECLINED). Declines flash.
4. **CARD** — last4, current scope, outstanding balance.

SSE to `/api/stream`. No routing, no state library, no component library.

---

## 6. Config

```bash
# chain
MONAD_RPC_URL=
MONAD_CHAIN_ID=10143
CREDIT_FILE_ADDRESS=
SELLER_PRIVATE_KEY=
SELLER_ADDRESS=
BUYER_PRIVATE_KEYS=              # comma-separated, 3 keys

# x402
X402_NETWORK=eip155:10143
X402_FACILITATOR_URL=https://x402-facilitator.molandak.org
X402_ASSET_ADDRESS=0x534b2f3A21130d7a60830c2Df862319e593943A3
PRICE_PER_CALL_MICRO=50000       # $0.05

# underwriting
EARNINGS_WINDOW_SECS=120
HORIZON_SECS=600
CAP_MICRO=200000000              # $200
SYNC_THRESHOLD_MICRO=500000      # $0.50

# rain
RAIN_MODE=mock                   # mock | live
RAIN_API_KEY=
RAIN_API_BASE=
RAIN_WEBHOOK_SECRET=

# demo
BUYER_COUNT=3
CALLS_PER_SEC_PER_BUYER=3        # ~9/sec ≈ $27/min
```

`BUYER_COUNT` and `CALLS_PER_SEC_PER_BUYER` are the demo dials. $0.05 × 9/sec = $27/min, so the limit climbs visibly within a three-minute window. This is a plausible busy minute for a real service, not a cheat.

---

## 7. Build order (solo)

The original plan assumed four people with M5 running in parallel. Solo, that parallelism is gone, and one reorder matters: **smoke-test x402 against Monad's facilitator before building the contract.** The contract is the part we know will work; x402 v2 against a third-party facilitator is the part that might not. Discovering a facilitator problem at hour one leaves a day to route around it.

| # | Milestone | Done when | Est |
|---|---|---|---|
| M0 | Workspace, shared types/money/config, four apps booting | `pnpm dev` starts everything clean | 30m |
| M0.5 | x402 smoke test, one paid call, no contract | a buyer gets 200 after paying | 15m |
| M1 | `CreditFile.sol` + batch, compile, test, deploy | receipt tx confirmed, visible in explorer | 45m |
| M2 | Seller + buyers wired, receipts landing onchain | paid call returns 200, receipt tx hash in logs | 60m |
| M3 | Poller, limit engine, SSE | limit rises with buyers on, decays to zero within the window when off | 60m |
| M4 | Rain interface, mock, auth endpoint + HMAC | synthetic auths approve below limit, decline above, every decision under 800ms | 45m |
| M4.5 | Live Rain probe + ngrok tunnel | real webhook shape known and parsed | 45m |
| M5 | Dashboard | full cycle legible on a projector, no terminal visible | 75m |
| M6 | Real purchase, rehearsal, backup video | real authorization appears on dashboard | — |

**Feature freeze 8:00 PM.** After that, demo polish only. No new code paths.

---

## 8. Cut list

Cut in this order when behind. Do not negotiate.

1. Staking / slashing — already out of scope, do not build.
2. Repayment sweep.
3. Multiple merchants — one allowlisted merchant is enough.
4. Onchain profile aggregation — move the math off-chain, keep the contract as a dumb event log.
5. Dashboard animations.

**Never cut:** the real authorization, and the decline.

---

## 9. Non-goals

Do not build these. If you find yourself building one, stop.

- User accounts, login, auth on our own services
- A database or any persistence
- A real scraper — fixtures only
- Retry/backoff frameworks, circuit breakers, queues beyond the one receipt serializer
- Tests beyond the one contract test and one auth-decision test
- Error handling for anything off the demo path, except the webhook HMAC
- Docker, CI, deployment configs
- Mobile responsiveness
- Multi-agent support — exactly one earning agent exists

---

## 10. Known traps

| Trap | Handling |
|---|---|
| Nonce races on receipt writes | Single async queue with a nonce manager, plus batching. Non-optional. |
| Blocking RPC inside the auth handler | Never. Read the in-memory profile the poller maintains. |
| Float arithmetic on money | `bigint` micro-USD everywhere. Format only in the UI. |
| Receipt scan cap too low for demo rate | Cap raised to 2000. See 3.5. |
| Rain webhook shape unknown | Adapter interface plus mock. Only `LiveRainClient` and one parse function change. |
| Webhook publicly exposed via tunnel | HMAC verification on the authorization endpoint. |
| Testnet faucet limits | Fund all 4 wallets first. Check balances before the demo. |
| Facilitator flaky | Fallback is a local facilitator. Do not build preemptively. |

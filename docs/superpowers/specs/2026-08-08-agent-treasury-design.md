# Agent Treasury — Design Spec

**Date:** 2026-08-08
**Status:** Approved, ready for implementation planning
**Supersedes parts of:** [2026-08-08-float-design.md](2026-08-08-float-design.md)

---

## 1. What changes and why

FLOAT proved a single agent could earn onchain and hold a card whose limit tracked those earnings. This spec generalizes it into a treasury:

- **Many agents earn**, not one.
- Earnings **pool** into a single user-owned treasury.
- The user defines **bills** they want covered.
- A deterministic planner **reserves** funds against those bills and derives card scope from them.
- When a biller charges the card, the authorization is approved or declined against reservations, still inside the authorization window.

Two of FLOAT's explicit non-goals are now requirements: multi-agent support, and persistence.

### 1.1 The reframing that shaped this design

The user's bills are household obligations — subscriptions, rent, utilities. Those billers do not expose checkouts an agent can drive; they require the card to be registered once by a human, after which **they** charge on their own schedule. 3DS prompts and OTPs block automation even where a form exists.

So the spending agent cannot be the payer. Its role is **guarantor**, not initiator:

1. Hold the bill schedule — payee, amount, due date, priority.
2. Forecast pooled earnings against upcoming obligations.
3. Reserve funds per bill so discretionary spend cannot consume rent.
4. Derive card scope — merchant allowlist and per-merchant caps.
5. Approve or decline the real authorization in under 800ms.
6. Warn when projected income will not cover what is due.

This is the harder and more valuable half. "Can this agent's income cover rent on the 5th, and should I let this charge through right now?" is a real question.

---

## 2. Decisions

| Question | Decision |
|---|---|
| Whose money is it? | **Pooled.** All agents' earnings combine into one user-owned treasury. Per-agent figures kept for reporting only. |
| Is the planner an LLM? | **No.** Deterministic scheduling logic. An LLM layer can sit on top later without touching the execution path. |
| How do expenses get paid? | Billers charge the card; we approve or decline. A simulated biller harness drives this during development. |
| What are the expenses? | Household bills — subscriptions, rent, utilities. |
| Persistence | **SQLite via Node's built-in `node:sqlite`.** One file, no server, and `DatabaseSync` gives synchronous reads so the auth path never awaits I/O. Requires the `--experimental-sqlite` flag on Node 22. `better-sqlite3` was the first choice and was rejected: it needs a node-gyp native build, which fails on the build machine (no MSVC toolchain). |
| Multi-tenancy | **Single user.** No accounts, no login. YAGNI until there is a second user. |

---

## 3. What stays, what changes

| Component | Change |
|---|---|
| `CreditFile.sol` | **None.** Already keyed `mapping(address => Receipt[])` with `getProfile(address agent, ...)`. Multi-agent ready as written. |
| bigint micro-USD discipline | Unchanged. Still the settlement unit; USDC's 6 decimals make it 1:1. |
| x402 seller pattern | Extended: one process, several services, each a distinct agent identity. |
| `RainClient` interface | Extended: `CardScope` carries per-merchant caps. |
| Sub-millisecond auth path | Preserved. Now reservation-aware. |
| `watcher.ts` | Polls N agents, aggregates into a pooled profile. |
| `underwriter` | Gains `db/`, `bills/`, `planner/`. |
| `biller-sim` | New app. |

---

## 4. Architecture

```
seller-agent (:3001)                          CreditFile (Monad)
  ├── service: price   → wallet A ──receipts──────┐
  ├── service: scrape  → wallet B ──receipts──────┤
  └── service: shop    → wallet C ──receipts──────┤
                                                   │
buyer-agents (:3002) ──x402 pay──> seller           │ poll N agents
                                                   ▼
dashboard (:5173) <──SSE── underwriter (:3003) ──scope──> Rain
                              │   ├── treasury (memory, from chain)
                              │   ├── planner  (reservations)
                              │   └── SQLite   (agents, bills, reservations)
                              ▲
biller-sim (:3004) ──charges──┘  POST /webhooks/rain/authorization
```

The planner runs **inside** the underwriter process. The auth path must read reservations from memory; a network hop in front of that would break the sub-millisecond guarantee that is the entire thesis.

---

## 5. Data model

Earnings are never stored. The chain is the source of truth and the watcher keeps a live view. The database holds only what the chain cannot know: which agents to watch, what the user owes, and what has been reserved.

```sql
CREATE TABLE agents (
  address     TEXT PRIMARY KEY,   -- 0x…, the receipt msg.sender
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL,      -- price | scrape | shop
  active      INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE bills (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  merchant_id   TEXT NOT NULL,
  mcc           TEXT NOT NULL,
  amount_micro  TEXT NOT NULL,    -- bigint as decimal string
  cadence       TEXT NOT NULL,    -- monthly | weekly
  due_day       INTEGER NOT NULL, -- 1..28 for monthly, 0..6 for weekly (0 = Sunday)
  priority      INTEGER NOT NULL, -- lower funds first
  tolerance_bps INTEGER NOT NULL DEFAULT 500,  -- utilities vary; 5% headroom
  active        INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE reservations (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  bill_id       INTEGER NOT NULL REFERENCES bills(id),
  amount_micro  TEXT NOT NULL,
  due_at        INTEGER NOT NULL,  -- epoch ms
  status        TEXT NOT NULL,     -- funded | partial | consumed | released
  created_at    INTEGER NOT NULL,
  consumed_at   INTEGER
);

CREATE TABLE authorizations (
  auth_id       TEXT PRIMARY KEY,
  merchant_id   TEXT NOT NULL,
  amount_micro  TEXT NOT NULL,
  approved      INTEGER NOT NULL,
  reason        TEXT NOT NULL,
  elapsed_ms    REAL NOT NULL,
  bill_id       INTEGER REFERENCES bills(id),
  created_at    INTEGER NOT NULL
);
```

Cadence is `monthly` or `weekly` only. A one-off payment is just a discretionary charge; reservations exist for recurring obligations, and a `once` cadence would need a nullable absolute-date column that nothing else reads.

Money columns are `TEXT` holding decimal strings, converted to `bigint` at the boundary. SQLite integers are 64-bit signed, which is enough today, but strings keep the discipline uniform and remove any chance of a driver silently coercing to float.

---

## 6. Treasury math

```
limitMicro         = f(pooled earnings across all active agents)   ← existing engine
reservedMicro      = Σ amount of reservations in status funded|partial
outstandingMicro   = Σ approved-but-unsettled authorizations
discretionaryMicro = max(0, limitMicro − outstandingMicro − reservedMicro)
```

The pooled profile is the per-agent profiles summed:

```
earnedInWindowMicro = Σ agent.earnedInWindowMicro
totalEarnedMicro    = Σ agent.totalEarnedMicro
distinctPayers      = size of the union of payers across agents
```

`distinctPayers` uses the union, not the sum, so three agents each serving the same single payer does not score as diversity that is not there. This requires payer identity, not just a count, so the watcher reads `getReceipts` for the window alongside `getProfile`.

The existing limit engine is unchanged — projection over the horizon, diversity discount, cap. It simply consumes the pooled profile.

---

## 7. Authorization decision

This is the critical path and it still reads only memory. No RPC, no Rain call, no database write before responding.

```
1. Verify HMAC.
2. Parse into AuthRequest.
3. Match merchant_id against reservations in status funded|partial.

   MATCHED and amount ≤ reservation.amount × (1 + tolerance):
     → APPROVE. Consume the reservation. Rent goes through even when
       discretionary is zero.

   MATCHED but amount exceeds the reservation plus tolerance:
     → DECLINE. A biller charging more than the bill is exactly what
       scope is meant to catch.

   UNMATCHED merchant:
     → APPROVE only if amount ≤ discretionaryMicro.

4. Add to outstanding, log, emit SSE, respond.
5. Persist the authorization row asynchronously, after responding.
```

Consuming a reservation moves the same amount out of `reservedMicro` and into `outstandingMicro`, so `discretionaryMicro` is unchanged by a reserved charge. That is intended: paying rent from money already earmarked for rent must not shrink — or grow — the discretionary pool. Only unmatched charges reduce it.

Step 5 happens after the response is sent. Writing to SQLite is fast, but the guarantee is that nothing between receiving the request and answering it touches durable storage.

The 800ms deadline still declines on expiry. A timeout that declines is correct; a hang is a failed demo.

---

## 8. Planner

Runs on an interval (default 5s), fully deterministic:

```
1. Load active bills. Compute next due date for each from cadence + due_day.
2. Keep bills due within RESERVATION_HORIZON_DAYS (default 35).
3. Sort by priority ascending, then due date ascending.
4. budget = limitMicro − outstandingMicro
5. For each bill in order:
     want  = bill.amount_micro
     grant = min(want, budget)
     upsert reservation(bill, grant, due_at)
     status = grant == want ? funded : partial
     budget -= grant
6. Release reservations for bills that became inactive or already consumed.
7. Emit a coverage forecast.
```

Partial funding is deliberate and is how shortfalls surface: "rent is 60% covered; at the current earn rate you are $400 short by the 5th." Silently skipping an unaffordable bill would hide exactly the fact the user needs.

**Shortfall projection.** Current earn rate is `earnedInWindowMicro / earningsWindowSecs`. Multiply by seconds remaining until each due date, add to the current limit, and compare against cumulative obligations in priority order. A bill is flagged when projected coverage at its due date is below its amount.

---

## 9. Card scope

Scope is derived from reservations, never set by hand:

```
allowedMerchants = merchant_id of every reservation in funded|partial
                   + DISCRETIONARY_MERCHANTS (config, may be empty)
perMerchantCapMicro[m] = reservation.amount × (1 + tolerance_bps/10000)
totalLimitMicro  = limitMicro
```

`CardScope` gains `perMerchantCaps: Record<string, bigint>`. `MockRainClient` honours the caps in its synthetic authorizations. `LiveRainClient` maps them to Rain's per-merchant control fields, confirmed during the live probe.

Scope sync stays debounced at one call per 2 seconds, triggered when total available or any per-merchant cap moves by more than `SYNC_THRESHOLD_MICRO`.

---

## 10. Multi-service seller

`CreditFile` keys receipts by `msg.sender`, so a second agent requires a second wallet. Adding a `recordReceiptFor(agent, …)` shim would let one wallet write on behalf of many, and would destroy the "provably earned" property that makes the project interesting. It is not done.

Instead the seller runs several services in one process:

| Service | Route | Agent wallet | Default price |
|---|---|---|---|
| price | `GET /price?sku=` | `AGENT_PRICE_PRIVATE_KEY` | $0.05 |
| scrape | `GET /scrape?url=` | `AGENT_SCRAPE_PRIVATE_KEY` | $0.02 |
| shop | `GET /shop?query=` | `AGENT_SHOP_PRIVATE_KEY` | $0.10 |

Each service gets its own x402 route config, its own `ReceiptRecorder` with its own nonce-serialized batching queue, and its own agent row. All three wallets need gas.

Responses stay fixture-driven with jitter. There is still no scraper; `/scrape` returns plausible fixture extractions. Nobody is judging the scraper.

### 10.1 Pricing floor

USDC has 6 decimals, so the smallest settleable amount is **1 micro-USD ($0.000001)**. Prices below that cannot be settled or recorded and are rejected at config validation.

Sub-cent pricing is supported but has an economic consequence worth stating plainly: at $0.00005 per call, nine calls per second earns about $0.027 per hour, which cannot fund a household bill in any useful timeframe. Demo defaults are therefore set at cents, not fractions of cents. Prices are per-service config and can be lowered when volume justifies it.

---

## 11. API surface

```
GET    /api/state                     full snapshot incl. treasury + reservations
GET    /api/stream                    SSE
GET    /api/agents                    registered agents + per-agent earnings
POST   /api/agents                    register an agent address
GET    /api/bills                     list
POST   /api/bills                     create
PATCH  /api/bills/:id                 update
DELETE /api/bills/:id                 deactivate
GET    /api/plan                      current reservations + coverage forecast
POST   /webhooks/rain/authorization   the critical path
POST   /api/demo/income/{start|stop}
POST   /api/demo/reset
```

Bill writes are validated at the boundary: amount must be a positive integer micro-USD string, cadence from the enum, `due_day` in range for the cadence, priority a non-negative integer.

---

## 12. biller-sim

New app on :3004. Reads bills from the underwriter, and on each bill's due date fires a charge at the authorization webhook with that bill's `merchant_id`, `mcc`, and amount. A `POST /control/charge/:billId` endpoint triggers one immediately so the loop is demonstrable without waiting for a date, and `POST /control/charge-excess/:billId` fires an over-amount charge to show the per-merchant cap declining it.

It signs requests with `RAIN_WEBHOOK_SECRET` so the HMAC path is exercised rather than bypassed.

---

## 13. Config additions

```bash
# agents
AGENT_PRICE_PRIVATE_KEY=
AGENT_SCRAPE_PRIVATE_KEY=
AGENT_SHOP_PRIVATE_KEY=
PRICE_MICRO_PRICE=50000
PRICE_MICRO_SCRAPE=20000
PRICE_MICRO_SHOP=100000

# treasury
DB_PATH=./float.db
RESERVATION_HORIZON_DAYS=35
PLANNER_INTERVAL_MS=5000
DISCRETIONARY_MERCHANTS=          # comma-separated, may be empty

# biller-sim
BILLER_SIM_PORT=3004
```

---

## 14. Build order

| # | Milestone | Done when |
|---|---|---|
| T0 | SQLite layer, schema, migrations, bill CRUD + validation | bills survive a restart |
| T1 | Agent registry, multi-agent watcher, pooled profile | two agents' earnings sum correctly, payer union is right |
| T2 | Multi-service seller, three wallets, three receipt queues | three distinct agent addresses accrue onchain |
| T3 | Planner: reservations, priority funding, partial funding | reservations fund in priority order and shortfall is reported |
| T4 | Reservation-aware auth + per-merchant caps | reserved bill approves at zero discretionary; over-amount declines |
| T5 | biller-sim | a simulated charge on a due date approves through the real webhook |
| T6 | Dashboard: treasury, reservations, coverage forecast | shortfall is legible without reading a terminal |

T0 and T1 are independent and can be built in either order. T3 depends on both. T4 depends on T3.

---

## 15. Testing

Extending FLOAT's minimal posture, not abandoning it. Tests are added only where logic is non-obvious and money is at stake:

- Limit engine over a pooled profile, including payer-union diversity.
- Planner: priority ordering, partial funding, release on deactivation.
- Auth decisions: reserved-approve at zero discretionary, over-tolerance decline, unmatched-merchant discretionary path.
- Bill input validation.

No tests for CRUD plumbing, SSE transport, or fixture generation.

---

## 16. Non-goals

- Frontend beyond the existing dashboard
- Additional earning agents beyond the three services
- LLM-driven planning
- Real biller registration or card-on-file automation
- User accounts, login, multi-tenancy
- Repayment sweep — earnings back out to settle the card balance
- Retry frameworks, circuit breakers, queues beyond the per-agent receipt serializers
- Docker, CI, deployment configs

---

## 17. Known risks

| Risk | Handling |
|---|---|
| Three wallets × batched writes triples gas and nonce surface | Each agent gets its own serialized queue; rates are per-service config and can be lowered |
| `getReceipts` for payer union is heavier than `getProfile` | Already capped at 2000 receipts; if `eth_call` slows, fall back to counting distinct payers per agent and taking the max |
| Reservation consumed by the wrong charge | Match on `merchant_id` **and** amount within tolerance; log every match decision with the bill it resolved to |
| A biller charges early, before the reservation is funded | Reservation horizon is 35 days, wider than any monthly cycle, so a funded reservation exists well before the due date |
| Clock/timezone drift on due dates | All due dates computed in UTC and stored as epoch ms |
| SQLite write blocking the auth path | Authorization rows are written after the response is sent |

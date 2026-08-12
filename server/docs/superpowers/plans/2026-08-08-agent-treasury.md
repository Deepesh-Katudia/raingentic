# Agent Treasury Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generalize the existing FLOAT codebase from one earning agent to a pooled multi-agent treasury that reserves earned income against user-defined recurring bills and approves card authorizations against those reservations.

**Architecture:** Three x402-priced services run in one seller process, each with its own wallet, so each is a distinct onchain agent identity. The underwriter polls all agents, sums them into a pooled profile, and runs a deterministic planner that reserves funds against bills in priority order. Card scope is derived from reservations. The authorization path reads only memory and stays sub-millisecond.

**Tech Stack:** TypeScript, Node 22 (ESM), Express, viem, `@x402/*` v2.21.0, `node:sqlite`, Solidity 0.8.24 via solc-js.

**Source spec:** `docs/superpowers/specs/2026-08-08-agent-treasury-design.md`

## Global Constraints

- **Money is always `bigint` micro-USD.** 1 USD = `1_000_000n`. USDC on Monad has 6 decimals so one base unit is one micro-USD. Never use floats for money. Format only at the UI edge via `formatUsd`/`formatUsdSymbol` from `@float/shared`.
- **Minimum settleable amount is 1 micro-USD** (`$0.000001`). Prices below this are rejected at config validation.
- **The authorization path never awaits I/O.** No RPC call, no Rain call, no database read or write between receiving `POST /webhooks/rain/authorization` and responding. Database writes happen after the response is sent.
- **`node:sqlite` requires the `--experimental-sqlite` flag.** Every script that opens the database must pass it.
- **Money in SQLite is `TEXT`** holding a decimal string, converted with `parseMicro` (read) and `String(value)` (write).
- **`CreditFile.sol` is not modified.** It is already keyed `mapping(address => Receipt[])`.
- **No `recordReceiptFor()` shim.** Receipts are written by the earning agent's own wallet so `msg.sender` is the agent. A shim would destroy the "provably earned" property.
- **Existing tests must keep passing:** `pnpm -F @float/underwriter test` (5 tests as of the starting commit).
- Cadence is `monthly` or `weekly` only. `due_day` is 1..28 for monthly, 0..6 for weekly (0 = Sunday).
- All due dates are computed in **UTC** and stored as epoch milliseconds.

## Scope

This plan covers **T0–T5 of the spec: the backend.** T6 (dashboard treasury view) is deliberately excluded and gets its own plan — the user asked for the backend first.

## File Structure

**New files:**

| File | Responsibility |
|---|---|
| `apps/underwriter/src/db/schema.ts` | DDL string, one export |
| `apps/underwriter/src/db/index.ts` | Open database, apply schema, expose the handle |
| `apps/underwriter/src/bills/types.ts` | `Bill`, `BillInput`, `Cadence` |
| `apps/underwriter/src/bills/validate.ts` | Boundary validation for bill input |
| `apps/underwriter/src/bills/repo.ts` | Bill persistence queries |
| `apps/underwriter/src/agents/repo.ts` | Agent registry persistence |
| `apps/underwriter/src/api/bills.ts` | Express router for bill CRUD |
| `apps/underwriter/src/api/agents.ts` | Express router for agent registry |
| `apps/underwriter/src/treasury.ts` | Pool per-agent profiles into one |
| `apps/underwriter/src/planner/dueDates.ts` | Next-due-date computation |
| `apps/underwriter/src/planner/reservations.ts` | Pure reservation allocation |
| `apps/underwriter/src/planner/forecast.ts` | Cumulative coverage projection |
| `apps/underwriter/src/planner/index.ts` | Planner loop and reservation persistence |
| `apps/seller-agent/src/services.ts` | Service definitions, one per agent identity |
| `apps/biller-sim/*` | Simulated biller that charges the webhook |

**Modified files:**

| File | Change |
|---|---|
| `packages/shared/src/types.ts` | Add `AgentProfile`, `PooledProfile`, `Reservation`, `CoverageForecast` |
| `packages/shared/src/config.ts` | Add `agentsConfig`, `treasuryConfig`, `billerSimConfig`; price floor check |
| `apps/underwriter/src/watcher.ts` | Poll N agents, return per-agent profiles with payer sets |
| `apps/underwriter/src/state.ts` | Hold pooled profile, reservations, discretionary split |
| `apps/underwriter/src/auth.ts` | Reservation matching before discretionary fallback |
| `apps/underwriter/src/rain/types.ts` | `CardScope.perMerchantCaps` |
| `apps/underwriter/src/rain/mock.ts` | Honour per-merchant caps |
| `apps/underwriter/src/index.ts` | Wire db, registry, planner, routers |
| `apps/seller-agent/src/index.ts` | Mount one x402 route per service |
| `package.json` | Add `biller-sim` to `dev` script |

---

## Task 1: SQLite foundation

**Files:**
- Create: `apps/underwriter/src/db/schema.ts`
- Create: `apps/underwriter/src/db/index.ts`
- Create: `apps/underwriter/test/db.test.ts`
- Modify: `apps/underwriter/package.json` (scripts gain `--experimental-sqlite`)
- Modify: `packages/shared/src/config.ts` (add `treasuryConfig`)

**Interfaces:**
- Consumes: `parseMicro` from `@float/shared`
- Produces:
  - `SCHEMA_SQL: string`
  - `openDb(path: string): DatabaseSync` — opens, enables WAL and foreign keys, applies schema idempotently
  - `treasuryConfig(): { dbPath: string; reservationHorizonDays: number; plannerIntervalMs: number; discretionaryMerchants: string[] }`

- [ ] **Step 1: Write the failing test**

Create `apps/underwriter/test/db.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db/index.js";

test("applies schema and persists a row across reopen", () => {
  const path = `./test-${Date.now()}.db`;
  const db = openDb(path);

  db.prepare(
    "INSERT INTO bills (name, merchant_id, mcc, amount_micro, cadence, due_day, priority) VALUES (?,?,?,?,?,?,?)",
  ).run("Rent", "mrc_landlord", "6513", "1200000000", "monthly", 5, 0);
  db.close();

  const reopened = openDb(path);
  const rows = reopened.prepare("SELECT name, amount_micro FROM bills").all();
  reopened.close();

  assert.equal(rows.length, 1);
  assert.equal((rows[0] as { name: string }).name, "Rent");
  assert.equal((rows[0] as { amount_micro: string }).amount_micro, "1200000000");
});

test("opening twice does not error on existing tables", () => {
  const path = `./test-idem-${Date.now()}.db`;
  openDb(path).close();
  const second = openDb(path);
  const tables = second.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
  second.close();

  const names = tables.map((t) => (t as { name: string }).name);
  for (const expected of ["agents", "bills", "reservations", "authorizations"]) {
    assert.ok(names.includes(expected), `missing table ${expected}`);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/underwriter && pnpm test`
Expected: FAIL — cannot find module `../src/db/index.js`

- [ ] **Step 3: Write the schema**

Create `apps/underwriter/src/db/schema.ts`:

```ts
/**
 * Money columns are TEXT holding decimal micro-USD strings. SQLite integers are
 * 64-bit signed and would fit today, but strings keep the bigint discipline
 * uniform and remove any chance of a driver coercing a value to float.
 */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS agents (
  address     TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL,
  active      INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS bills (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  merchant_id   TEXT NOT NULL,
  mcc           TEXT NOT NULL,
  amount_micro  TEXT NOT NULL,
  cadence       TEXT NOT NULL,
  due_day       INTEGER NOT NULL,
  priority      INTEGER NOT NULL,
  tolerance_bps INTEGER NOT NULL DEFAULT 500,
  active        INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS reservations (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  bill_id       INTEGER NOT NULL REFERENCES bills(id),
  amount_micro  TEXT NOT NULL,
  due_at        INTEGER NOT NULL,
  status        TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  consumed_at   INTEGER
);

CREATE TABLE IF NOT EXISTS authorizations (
  auth_id       TEXT PRIMARY KEY,
  merchant_id   TEXT NOT NULL,
  amount_micro  TEXT NOT NULL,
  approved      INTEGER NOT NULL,
  reason        TEXT NOT NULL,
  elapsed_ms    REAL NOT NULL,
  bill_id       INTEGER REFERENCES bills(id),
  created_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_reservations_status ON reservations(status);
CREATE INDEX IF NOT EXISTS idx_bills_active ON bills(active);
`;
```

- [ ] **Step 4: Write the database opener**

Create `apps/underwriter/src/db/index.ts`:

```ts
import { DatabaseSync } from "node:sqlite";
import { SCHEMA_SQL } from "./schema.js";

/**
 * Opens the treasury database and applies the schema idempotently.
 *
 * DatabaseSync is deliberate: every read on the authorization path must be
 * synchronous so the decision never awaits I/O. node:sqlite is used instead of
 * better-sqlite3 because the latter needs a node-gyp native build that fails on
 * the build machine.
 */
export function openDb(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(SCHEMA_SQL);
  return db;
}

export type Db = DatabaseSync;
```

- [ ] **Step 5: Add the experimental flag to scripts**

In `apps/underwriter/package.json`, replace the `scripts` block with:

```json
  "scripts": {
    "dev": "tsx watch --node-options=\"--experimental-sqlite --no-warnings\" src/index.ts",
    "start": "tsx --node-options=\"--experimental-sqlite --no-warnings\" src/index.ts",
    "test": "node --experimental-sqlite --no-warnings --import tsx --test test/*.test.ts"
  },
```

- [ ] **Step 6: Add treasury config**

In `packages/shared/src/config.ts`, add after `underwritingConfig`:

```ts
export function treasuryConfig() {
  return {
    dbPath: opt("DB_PATH", "./float.db"),
    reservationHorizonDays: reqInt("RESERVATION_HORIZON_DAYS", 35),
    plannerIntervalMs: reqInt("PLANNER_INTERVAL_MS", 5000),
    discretionaryMerchants: opt("DISCRETIONARY_MERCHANTS", "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  };
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd apps/underwriter && pnpm test`
Expected: PASS — 7 tests (5 existing auth + 2 new db)

- [ ] **Step 8: Ignore test databases**

Append to `.gitignore`:

```
*.db
*.db-wal
*.db-shm
```

- [ ] **Step 9: Commit**

```bash
git add apps/underwriter/src/db apps/underwriter/test/db.test.ts apps/underwriter/package.json packages/shared/src/config.ts .gitignore
git commit -m "feat: sqlite foundation for the treasury"
```

---

## Task 2: Bill repository and validation

**Files:**
- Create: `apps/underwriter/src/bills/types.ts`
- Create: `apps/underwriter/src/bills/validate.ts`
- Create: `apps/underwriter/src/bills/repo.ts`
- Create: `apps/underwriter/test/bills.test.ts`

**Interfaces:**
- Consumes: `openDb`, `Db` from Task 1; `parseMicro` from `@float/shared`
- Produces:
  - `type Cadence = "monthly" | "weekly"`
  - `interface Bill { id: number; name: string; merchantId: string; mcc: string; amountMicro: bigint; cadence: Cadence; dueDay: number; priority: number; toleranceBps: number; active: boolean }`
  - `interface BillInput { name: string; merchantId: string; mcc: string; amountMicro: string; cadence: string; dueDay: number; priority: number; toleranceBps?: number }`
  - `validateBillInput(raw: unknown): { ok: true; value: Omit<Bill,"id"|"active"> } | { ok: false; error: string }`
  - `class BillRepo { constructor(db: Db); create(b): Bill; list(activeOnly?: boolean): Bill[]; get(id: number): Bill | null; update(id, patch): Bill | null; deactivate(id: number): boolean }`

- [ ] **Step 1: Write the failing test**

Create `apps/underwriter/test/bills.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db/index.js";
import { BillRepo } from "../src/bills/repo.js";
import { validateBillInput } from "../src/bills/validate.js";

function repo() {
  return new BillRepo(openDb(":memory:"));
}

const VALID = {
  name: "Rent",
  merchantId: "mrc_landlord",
  mcc: "6513",
  amountMicro: "1200000000",
  cadence: "monthly",
  dueDay: 5,
  priority: 0,
};

test("accepts a well-formed bill", () => {
  const result = validateBillInput(VALID);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.amountMicro, 1_200_000_000n);
    assert.equal(result.value.toleranceBps, 500);
  }
});

test("rejects a non-positive amount", () => {
  const result = validateBillInput({ ...VALID, amountMicro: "0" });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /amountMicro/);
});

test("rejects a fractional amount string", () => {
  const result = validateBillInput({ ...VALID, amountMicro: "12.50" });
  assert.equal(result.ok, false);
});

test("rejects an unknown cadence", () => {
  const result = validateBillInput({ ...VALID, cadence: "yearly" });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /cadence/);
});

test("rejects a monthly due day outside 1..28", () => {
  assert.equal(validateBillInput({ ...VALID, dueDay: 0 }).ok, false);
  assert.equal(validateBillInput({ ...VALID, dueDay: 29 }).ok, false);
  assert.equal(validateBillInput({ ...VALID, dueDay: 28 }).ok, true);
});

test("rejects a weekly due day outside 0..6", () => {
  const weekly = { ...VALID, cadence: "weekly" };
  assert.equal(validateBillInput({ ...weekly, dueDay: 7 }).ok, false);
  assert.equal(validateBillInput({ ...weekly, dueDay: 6 }).ok, true);
});

test("round-trips a bill through the database", () => {
  const r = repo();
  const created = r.create(validateOrThrow(VALID));

  assert.ok(created.id > 0);
  assert.equal(created.amountMicro, 1_200_000_000n);
  assert.equal(created.active, true);

  const fetched = r.get(created.id);
  assert.equal(fetched?.name, "Rent");
  assert.equal(fetched?.amountMicro, 1_200_000_000n);
});

test("lists only active bills when asked", () => {
  const r = repo();
  const a = r.create(validateOrThrow(VALID));
  r.create(validateOrThrow({ ...VALID, name: "Netflix", merchantId: "mrc_netflix" }));

  r.deactivate(a.id);

  assert.equal(r.list().length, 2);
  assert.equal(r.list(true).length, 1);
  assert.equal(r.list(true)[0]?.name, "Netflix");
});

test("updates an amount and keeps it a bigint", () => {
  const r = repo();
  const created = r.create(validateOrThrow(VALID));

  const updated = r.update(created.id, { amountMicro: 1_500_000_000n });

  assert.equal(updated?.amountMicro, 1_500_000_000n);
});

function validateOrThrow(raw: unknown) {
  const res = validateBillInput(raw);
  if (!res.ok) throw new Error(res.error);
  return res.value;
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/underwriter && pnpm test`
Expected: FAIL — cannot find module `../src/bills/repo.js`

- [ ] **Step 3: Write the types**

Create `apps/underwriter/src/bills/types.ts`:

```ts
export type Cadence = "monthly" | "weekly";

export interface Bill {
  id: number;
  name: string;
  merchantId: string;
  mcc: string;
  amountMicro: bigint;
  cadence: Cadence;
  /** 1..28 for monthly, 0..6 for weekly (0 = Sunday). */
  dueDay: number;
  /** Lower funds first. */
  priority: number;
  /** Headroom over the bill amount, in basis points. Utilities vary. */
  toleranceBps: number;
  active: boolean;
}

export type NewBill = Omit<Bill, "id" | "active">;
```

- [ ] **Step 4: Write the validator**

Create `apps/underwriter/src/bills/validate.ts`:

```ts
import type { Cadence, NewBill } from "./types.js";

export type ValidationResult =
  | { ok: true; value: NewBill }
  | { ok: false; error: string };

const CADENCES: Cadence[] = ["monthly", "weekly"];

/** Monthly caps at 28 so every month has the day; no February special case. */
const MONTHLY_MAX_DAY = 28;
const WEEKLY_MAX_DAY = 6;

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

/**
 * Validates untrusted bill input at the HTTP boundary. Money arrives as a
 * decimal string and must be a positive integer count of micro-USD — a
 * fractional string would mean somebody did float math upstream.
 */
export function validateBillInput(raw: unknown): ValidationResult {
  if (typeof raw !== "object" || raw === null) return { ok: false, error: "body must be an object" };
  const b = raw as Record<string, unknown>;

  if (!isNonEmptyString(b.name)) return { ok: false, error: "name is required" };
  if (!isNonEmptyString(b.merchantId)) return { ok: false, error: "merchantId is required" };
  if (!isNonEmptyString(b.mcc)) return { ok: false, error: "mcc is required" };

  if (typeof b.amountMicro !== "string" || !/^\d+$/.test(b.amountMicro)) {
    return { ok: false, error: "amountMicro must be an integer string of micro-USD" };
  }
  const amountMicro = BigInt(b.amountMicro);
  if (amountMicro <= 0n) return { ok: false, error: "amountMicro must be greater than zero" };

  if (typeof b.cadence !== "string" || !CADENCES.includes(b.cadence as Cadence)) {
    return { ok: false, error: `cadence must be one of ${CADENCES.join(", ")}` };
  }
  const cadence = b.cadence as Cadence;

  if (typeof b.dueDay !== "number" || !Number.isInteger(b.dueDay)) {
    return { ok: false, error: "dueDay must be an integer" };
  }
  const maxDay = cadence === "monthly" ? MONTHLY_MAX_DAY : WEEKLY_MAX_DAY;
  const minDay = cadence === "monthly" ? 1 : 0;
  if (b.dueDay < minDay || b.dueDay > maxDay) {
    return { ok: false, error: `dueDay must be ${minDay}..${maxDay} for ${cadence}` };
  }

  if (typeof b.priority !== "number" || !Number.isInteger(b.priority) || b.priority < 0) {
    return { ok: false, error: "priority must be a non-negative integer" };
  }

  const toleranceBps = b.toleranceBps === undefined ? 500 : b.toleranceBps;
  if (typeof toleranceBps !== "number" || !Number.isInteger(toleranceBps) || toleranceBps < 0 || toleranceBps > 10_000) {
    return { ok: false, error: "toleranceBps must be an integer 0..10000" };
  }

  return {
    ok: true,
    value: {
      name: b.name.trim(),
      merchantId: b.merchantId.trim(),
      mcc: b.mcc.trim(),
      amountMicro,
      cadence,
      dueDay: b.dueDay,
      priority: b.priority,
      toleranceBps,
    },
  };
}
```

- [ ] **Step 5: Write the repository**

Create `apps/underwriter/src/bills/repo.ts`:

```ts
import type { Db } from "../db/index.js";
import type { Bill, Cadence, NewBill } from "./types.js";

interface BillRow {
  id: number;
  name: string;
  merchant_id: string;
  mcc: string;
  amount_micro: string;
  cadence: string;
  due_day: number;
  priority: number;
  tolerance_bps: number;
  active: number;
}

function toBill(row: BillRow): Bill {
  return {
    id: row.id,
    name: row.name,
    merchantId: row.merchant_id,
    mcc: row.mcc,
    amountMicro: BigInt(row.amount_micro),
    cadence: row.cadence as Cadence,
    dueDay: row.due_day,
    priority: row.priority,
    toleranceBps: row.tolerance_bps,
    active: row.active === 1,
  };
}

export class BillRepo {
  constructor(private readonly db: Db) {}

  create(bill: NewBill): Bill {
    const info = this.db
      .prepare(
        `INSERT INTO bills (name, merchant_id, mcc, amount_micro, cadence, due_day, priority, tolerance_bps)
         VALUES (?,?,?,?,?,?,?,?)`,
      )
      .run(
        bill.name,
        bill.merchantId,
        bill.mcc,
        String(bill.amountMicro),
        bill.cadence,
        bill.dueDay,
        bill.priority,
        bill.toleranceBps,
      );

    const created = this.get(Number(info.lastInsertRowid));
    if (!created) throw new Error("bill insert did not round-trip");
    return created;
  }

  get(id: number): Bill | null {
    const row = this.db.prepare("SELECT * FROM bills WHERE id = ?").get(id) as BillRow | undefined;
    return row ? toBill(row) : null;
  }

  list(activeOnly = false): Bill[] {
    const sql = activeOnly
      ? "SELECT * FROM bills WHERE active = 1 ORDER BY priority ASC, id ASC"
      : "SELECT * FROM bills ORDER BY priority ASC, id ASC";
    return (this.db.prepare(sql).all() as BillRow[]).map(toBill);
  }

  update(id: number, patch: Partial<NewBill>): Bill | null {
    const existing = this.get(id);
    if (!existing) return null;

    const next = { ...existing, ...patch };
    this.db
      .prepare(
        `UPDATE bills SET name=?, merchant_id=?, mcc=?, amount_micro=?, cadence=?,
         due_day=?, priority=?, tolerance_bps=? WHERE id=?`,
      )
      .run(
        next.name,
        next.merchantId,
        next.mcc,
        String(next.amountMicro),
        next.cadence,
        next.dueDay,
        next.priority,
        next.toleranceBps,
        id,
      );

    return this.get(id);
  }

  deactivate(id: number): boolean {
    const info = this.db.prepare("UPDATE bills SET active = 0 WHERE id = ?").run(id);
    return info.changes > 0;
  }
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd apps/underwriter && pnpm test`
Expected: PASS — 16 tests

- [ ] **Step 7: Commit**

```bash
git add apps/underwriter/src/bills apps/underwriter/test/bills.test.ts
git commit -m "feat: bill repository with boundary validation"
```

---

## Task 3: Agent registry and bill/agent HTTP API

**Files:**
- Create: `apps/underwriter/src/agents/repo.ts`
- Create: `apps/underwriter/src/api/bills.ts`
- Create: `apps/underwriter/src/api/agents.ts`
- Create: `apps/underwriter/test/agents.test.ts`
- Modify: `apps/underwriter/src/index.ts`

**Interfaces:**
- Consumes: `Db` (Task 1), `BillRepo`, `validateBillInput` (Task 2)
- Produces:
  - `interface AgentRecord { address: \`0x${string}\`; name: string; kind: string; active: boolean }`
  - `class AgentRepo { constructor(db: Db); upsert(a: AgentRecord): AgentRecord; list(activeOnly?: boolean): AgentRecord[]; deactivate(address: string): boolean }`
  - `createBillsRouter(repo: BillRepo): Router`
  - `createAgentsRouter(repo: AgentRepo, earnings: () => Record<string, string>): Router`

- [ ] **Step 1: Write the failing test**

Create `apps/underwriter/test/agents.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db/index.js";
import { AgentRepo } from "../src/agents/repo.js";

const A = "0x1111111111111111111111111111111111111111" as const;
const B = "0x2222222222222222222222222222222222222222" as const;

test("registers and lists agents", () => {
  const repo = new AgentRepo(openDb(":memory:"));

  repo.upsert({ address: A, name: "price", kind: "price", active: true });
  repo.upsert({ address: B, name: "scrape", kind: "scrape", active: true });

  assert.equal(repo.list().length, 2);
});

test("upsert replaces rather than duplicating", () => {
  const repo = new AgentRepo(openDb(":memory:"));

  repo.upsert({ address: A, name: "price", kind: "price", active: true });
  repo.upsert({ address: A, name: "price-v2", kind: "price", active: true });

  const all = repo.list();
  assert.equal(all.length, 1);
  assert.equal(all[0]?.name, "price-v2");
});

test("deactivated agents are excluded from the active list", () => {
  const repo = new AgentRepo(openDb(":memory:"));
  repo.upsert({ address: A, name: "price", kind: "price", active: true });
  repo.upsert({ address: B, name: "scrape", kind: "scrape", active: true });

  repo.deactivate(A);

  assert.equal(repo.list().length, 2);
  assert.equal(repo.list(true).length, 1);
  assert.equal(repo.list(true)[0]?.address, B);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/underwriter && pnpm test`
Expected: FAIL — cannot find module `../src/agents/repo.js`

- [ ] **Step 3: Write the agent repository**

Create `apps/underwriter/src/agents/repo.ts`:

```ts
import type { Db } from "../db/index.js";

export interface AgentRecord {
  address: `0x${string}`;
  name: string;
  kind: string;
  active: boolean;
}

interface AgentRow {
  address: string;
  name: string;
  kind: string;
  active: number;
}

function toAgent(row: AgentRow): AgentRecord {
  return {
    address: row.address as `0x${string}`,
    name: row.name,
    kind: row.kind,
    active: row.active === 1,
  };
}

export class AgentRepo {
  constructor(private readonly db: Db) {}

  upsert(agent: AgentRecord): AgentRecord {
    this.db
      .prepare(
        `INSERT INTO agents (address, name, kind, active) VALUES (?,?,?,?)
         ON CONFLICT(address) DO UPDATE SET name=excluded.name, kind=excluded.kind, active=excluded.active`,
      )
      .run(agent.address, agent.name, agent.kind, agent.active ? 1 : 0);
    return agent;
  }

  list(activeOnly = false): AgentRecord[] {
    const sql = activeOnly
      ? "SELECT * FROM agents WHERE active = 1 ORDER BY address"
      : "SELECT * FROM agents ORDER BY address";
    return (this.db.prepare(sql).all() as AgentRow[]).map(toAgent);
  }

  deactivate(address: string): boolean {
    return this.db.prepare("UPDATE agents SET active = 0 WHERE address = ?").run(address).changes > 0;
  }
}
```

- [ ] **Step 4: Write the bills router**

Create `apps/underwriter/src/api/bills.ts`:

```ts
import { Router } from "express";
import type { BillRepo } from "../bills/repo.js";
import { validateBillInput } from "../bills/validate.js";
import type { Bill } from "../bills/types.js";

/** Bills carry bigint money; serialize as strings so JSON never sees a float. */
function serialize(bill: Bill) {
  return { ...bill, amountMicro: bill.amountMicro.toString() };
}

export function createBillsRouter(repo: BillRepo): Router {
  const router = Router();

  router.get("/", (req, res) => {
    const activeOnly = req.query.active === "true";
    res.json(repo.list(activeOnly).map(serialize));
  });

  router.post("/", (req, res) => {
    const result = validateBillInput(req.body);
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    res.status(201).json(serialize(repo.create(result.value)));
  });

  router.patch("/:id", (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "id must be an integer" });
      return;
    }

    const existing = repo.get(id);
    if (!existing) {
      res.status(404).json({ error: "no such bill" });
      return;
    }

    // Validate the merged result so a partial update cannot produce an
    // invalid bill, e.g. switching cadence to weekly while dueDay is 28.
    const merged = {
      ...serialize(existing),
      ...(req.body as Record<string, unknown>),
    };
    const result = validateBillInput(merged);
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }

    res.json(serialize(repo.update(id, result.value)!));
  });

  router.delete("/:id", (req, res) => {
    const id = Number(req.params.id);
    if (!repo.deactivate(id)) {
      res.status(404).json({ error: "no such bill" });
      return;
    }
    res.json({ ok: true });
  });

  return router;
}
```

- [ ] **Step 5: Write the agents router**

Create `apps/underwriter/src/api/agents.ts`:

```ts
import { Router } from "express";
import type { AgentRepo, AgentRecord } from "../agents/repo.js";

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/**
 * @param earnings - returns per-agent total earned micro-USD keyed by lowercase
 *                   address, sourced from the chain watcher.
 */
export function createAgentsRouter(
  repo: AgentRepo,
  earnings: () => Record<string, string>,
): Router {
  const router = Router();

  router.get("/", (_req, res) => {
    const earned = earnings();
    res.json(
      repo.list().map((a) => ({
        ...a,
        totalEarnedMicro: earned[a.address.toLowerCase()] ?? "0",
      })),
    );
  });

  router.post("/", (req, res) => {
    const b = req.body as Partial<AgentRecord>;
    if (typeof b.address !== "string" || !ADDRESS_RE.test(b.address)) {
      res.status(400).json({ error: "address must be a 0x-prefixed 20-byte address" });
      return;
    }
    if (typeof b.name !== "string" || b.name.trim() === "") {
      res.status(400).json({ error: "name is required" });
      return;
    }

    const record: AgentRecord = {
      address: b.address as `0x${string}`,
      name: b.name.trim(),
      kind: typeof b.kind === "string" && b.kind.trim() ? b.kind.trim() : "unknown",
      active: b.active !== false,
    };
    res.status(201).json(repo.upsert(record));
  });

  router.delete("/:address", (req, res) => {
    if (!repo.deactivate(req.params.address)) {
      res.status(404).json({ error: "no such agent" });
      return;
    }
    res.json({ ok: true });
  });

  return router;
}
```

- [ ] **Step 6: Wire the routers into the underwriter**

In `apps/underwriter/src/index.ts`, add these imports below the existing `@float/shared` import block:

```ts
import { openDb } from "./db/index.js";
import { BillRepo } from "./bills/repo.js";
import { AgentRepo } from "./agents/repo.js";
import { createBillsRouter } from "./api/bills.js";
import { createAgentsRouter } from "./api/agents.js";
import { treasuryConfig } from "@float/shared";
```

Add after the `const seller = sellerConfig();` line:

```ts
const treasury = treasuryConfig();
const db = openDb(treasury.dbPath);
const billRepo = new BillRepo(db);
const agentRepo = new AgentRepo(db);
```

Add after the `app.use(express.json(...))` line:

```ts
app.use("/api/bills", createBillsRouter(billRepo));
app.use("/api/agents", createAgentsRouter(agentRepo, () => ({})));
```

The `() => ({})` earnings source is replaced with real per-agent earnings in Task 4.

- [ ] **Step 7: Run tests and typecheck**

Run: `cd apps/underwriter && pnpm test && ../../node_modules/.bin/tsc --noEmit --pretty false`
Expected: PASS — 19 tests, no type errors

- [ ] **Step 8: Verify the API by hand**

Run in one terminal: `cd apps/underwriter && pnpm dev`
Run in another:

```bash
curl -s -X POST localhost:3003/api/bills -H "content-type: application/json" \
  -d '{"name":"Rent","merchantId":"mrc_landlord","mcc":"6513","amountMicro":"1200000000","cadence":"monthly","dueDay":5,"priority":0}'
curl -s localhost:3003/api/bills
```

Expected: the POST returns 201 with `"amountMicro":"1200000000"`, the GET lists it. Restart the server and GET again — the bill is still there.

- [ ] **Step 9: Commit**

```bash
git add apps/underwriter/src/agents apps/underwriter/src/api apps/underwriter/test/agents.test.ts apps/underwriter/src/index.ts
git commit -m "feat: agent registry and bill/agent HTTP API"
```

---

## Task 4: Multi-agent watcher and pooled treasury

**Files:**
- Create: `apps/underwriter/src/treasury.ts`
- Create: `apps/underwriter/test/treasury.test.ts`
- Modify: `apps/underwriter/src/watcher.ts` (full rewrite)
- Modify: `apps/underwriter/src/state.ts:41-70` (profile handling)
- Modify: `packages/shared/src/types.ts` (add `AgentProfile`, `PooledProfile`)
- Modify: `apps/underwriter/src/index.ts` (construct watcher from registry)

**Interfaces:**
- Consumes: `AgentRepo` (Task 3), `creditFileAbi`, `monadTestnet` from `@float/shared`
- Produces:
  - `interface AgentProfile { address: string; earnedInWindowMicro: bigint; totalEarnedMicro: bigint; payers: string[] }`
  - `interface PooledProfile { earnedInWindowMicro: bigint; totalEarnedMicro: bigint; distinctPayers: number; perAgent: AgentProfile[]; readAt: number }`
  - `poolProfiles(profiles: AgentProfile[], readAt: number): PooledProfile`
  - `class ChainWatcher { constructor(creditFile, agents: () => \`0x${string}\`[], windowSecs, pollIntervalMs, store); start(); stop(); perAgentEarnings(): Record<string,string> }`

- [ ] **Step 1: Write the failing test**

Create `apps/underwriter/test/treasury.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { poolProfiles } from "../src/treasury.js";

const P1 = "0xaaaa000000000000000000000000000000000001";
const P2 = "0xbbbb000000000000000000000000000000000002";

test("sums earnings across agents", () => {
  const pooled = poolProfiles(
    [
      { address: "0xA", earnedInWindowMicro: 2_000_000n, totalEarnedMicro: 5_000_000n, payers: [P1] },
      { address: "0xB", earnedInWindowMicro: 3_000_000n, totalEarnedMicro: 4_000_000n, payers: [P2] },
    ],
    123,
  );

  assert.equal(pooled.earnedInWindowMicro, 5_000_000n);
  assert.equal(pooled.totalEarnedMicro, 9_000_000n);
  assert.equal(pooled.readAt, 123);
});

test("counts distinct payers as a union, not a sum", () => {
  // Three agents all serving the same single payer is not diversity.
  const pooled = poolProfiles(
    [
      { address: "0xA", earnedInWindowMicro: 1n, totalEarnedMicro: 1n, payers: [P1] },
      { address: "0xB", earnedInWindowMicro: 1n, totalEarnedMicro: 1n, payers: [P1] },
      { address: "0xC", earnedInWindowMicro: 1n, totalEarnedMicro: 1n, payers: [P1] },
    ],
    0,
  );

  assert.equal(pooled.distinctPayers, 1);
});

test("union is case-insensitive on payer address", () => {
  const pooled = poolProfiles(
    [
      { address: "0xA", earnedInWindowMicro: 1n, totalEarnedMicro: 1n, payers: [P1.toLowerCase()] },
      { address: "0xB", earnedInWindowMicro: 1n, totalEarnedMicro: 1n, payers: [P1.toUpperCase()] },
    ],
    0,
  );

  assert.equal(pooled.distinctPayers, 1);
});

test("empty agent list pools to zero", () => {
  const pooled = poolProfiles([], 0);

  assert.equal(pooled.earnedInWindowMicro, 0n);
  assert.equal(pooled.distinctPayers, 0);
  assert.equal(pooled.perAgent.length, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/underwriter && pnpm test`
Expected: FAIL — cannot find module `../src/treasury.js`

- [ ] **Step 3: Add the shared types**

Append to `packages/shared/src/types.ts`:

```ts
/** One agent's slice of the treasury, read from CreditFile. */
export interface AgentProfile {
  address: string;
  earnedInWindowMicro: bigint;
  totalEarnedMicro: bigint;
  /** Distinct payer addresses seen in the window, for union-based diversity. */
  payers: string[];
}

/** All agents' earnings combined. This is what the limit engine consumes. */
export interface PooledProfile {
  earnedInWindowMicro: bigint;
  totalEarnedMicro: bigint;
  distinctPayers: number;
  perAgent: AgentProfile[];
  readAt: number;
}
```

- [ ] **Step 4: Write the pooling function**

Create `apps/underwriter/src/treasury.ts`:

```ts
import type { AgentProfile, PooledProfile } from "@float/shared";

/**
 * Combine per-agent profiles into the pooled view the limit engine consumes.
 *
 * distinctPayers is the size of the union of payer sets, not the sum of
 * per-agent counts. Three agents each serving the same single customer is a
 * concentration risk, not diversity, and summing would score it as the latter.
 */
export function poolProfiles(profiles: AgentProfile[], readAt: number): PooledProfile {
  let earnedInWindowMicro = 0n;
  let totalEarnedMicro = 0n;
  const payers = new Set<string>();

  for (const p of profiles) {
    earnedInWindowMicro += p.earnedInWindowMicro;
    totalEarnedMicro += p.totalEarnedMicro;
    for (const payer of p.payers) payers.add(payer.toLowerCase());
  }

  return {
    earnedInWindowMicro,
    totalEarnedMicro,
    distinctPayers: payers.size,
    perAgent: profiles,
    readAt,
  };
}
```

- [ ] **Step 5: Rewrite the watcher for N agents**

Replace the entire contents of `apps/underwriter/src/watcher.ts`:

```ts
import { createPublicClient, http, type PublicClient } from "viem";
import { creditFileAbi, monadTestnet, type AgentProfile } from "@float/shared";
import { poolProfiles } from "./treasury.js";
import type { Store } from "./state.js";

/**
 * Keeps the pooled profile fresh so the auth path never touches the chain.
 *
 * Per agent it reads getProfile for the totals and getReceipts for the payer
 * set. getProfile alone returns only a count, which cannot be unioned across
 * agents — and the union is what makes diversity honest.
 */
export class ChainWatcher {
  private readonly client: PublicClient;
  private timer: NodeJS.Timeout | null = null;
  private unwatch: (() => void) | null = null;
  private lastKey = "";
  private earnings: Record<string, string> = {};

  constructor(
    private readonly creditFile: `0x${string}`,
    private readonly agents: () => `0x${string}`[],
    private readonly windowSecs: number,
    private readonly pollIntervalMs: number,
    private readonly store: Store,
  ) {
    const chain = monadTestnet();
    this.client = createPublicClient({
      chain,
      transport: http(chain.rpcUrls.default.http[0]),
    }) as PublicClient;
  }

  /** Per-agent total earned, keyed by lowercase address, for the agents API. */
  perAgentEarnings(): Record<string, string> {
    return this.earnings;
  }

  start(): void {
    if (this.timer) return;
    void this.poll();
    this.timer = setInterval(() => void this.poll(), this.pollIntervalMs);

    this.unwatch = this.client.watchContractEvent({
      address: this.creditFile,
      abi: creditFileAbi,
      eventName: "ReceiptRecorded",
      onLogs: (logs) => {
        const watched = new Set(this.agents().map((a) => a.toLowerCase()));
        for (const log of logs) {
          const a = log.args as { agent?: string; payer?: string; amountMicro?: bigint; timestamp?: bigint };
          if (!a.agent || !a.payer || a.amountMicro === undefined) continue;
          if (!watched.has(a.agent.toLowerCase())) continue;

          this.store.emit({
            type: "receipt",
            payer: a.payer,
            amountMicro: a.amountMicro.toString(),
            timestamp: Number(a.timestamp ?? 0n),
          });
        }
      },
      onError: (err) => console.error(`[watcher] event subscription: ${err.message}`),
    });
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.unwatch?.();
    this.unwatch = null;
  }

  private async readAgent(address: `0x${string}`, sinceTs: bigint): Promise<AgentProfile> {
    const [earnedInWindowMicro, , totalEarned] = await this.client.readContract({
      address: this.creditFile,
      abi: creditFileAbi,
      functionName: "getProfile",
      args: [address, BigInt(this.windowSecs)],
    });

    const receipts = await this.client.readContract({
      address: this.creditFile,
      abi: creditFileAbi,
      functionName: "getReceipts",
      args: [address, sinceTs],
    });

    return {
      address,
      earnedInWindowMicro,
      totalEarnedMicro: totalEarned,
      payers: receipts.map((r) => r.payer),
    };
  }

  private async poll(): Promise<void> {
    const agents = this.agents();
    if (agents.length === 0) return;

    try {
      const sinceTs = BigInt(Math.floor(Date.now() / 1000) - this.windowSecs);
      const profiles = await Promise.all(agents.map((a) => this.readAgent(a, sinceTs)));
      const pooled = poolProfiles(profiles, Date.now());

      this.earnings = Object.fromEntries(
        profiles.map((p) => [p.address.toLowerCase(), p.totalEarnedMicro.toString()]),
      );

      // Only touch the store when something moved, otherwise every poll
      // rebroadcasts an identical limit event to the dashboard.
      const key = `${pooled.earnedInWindowMicro}:${pooled.distinctPayers}:${pooled.totalEarnedMicro}`;
      if (key === this.lastKey) return;
      this.lastKey = key;

      this.store.setProfile(pooled);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[watcher] poll failed: ${message}`);
    }
  }
}
```

- [ ] **Step 6: Update the store to hold a pooled profile**

In `apps/underwriter/src/state.ts`, change the import line to add `PooledProfile`:

```ts
import type { CardSummary, LimitState, PooledProfile, StateSnapshot, StreamEvent } from "@float/shared";
```

Replace the `private profile: Profile = {...}` field with:

```ts
  private profile: PooledProfile = {
    earnedInWindowMicro: 0n,
    totalEarnedMicro: 0n,
    distinctPayers: 0,
    perAgent: [],
    readAt: 0,
  };
```

Change the `setProfile` signature to `setProfile(profile: PooledProfile): void`.

Remove the now-unused `Profile` import if TypeScript flags it.

- [ ] **Step 7: Wire the watcher to the registry**

In `apps/underwriter/src/index.ts`, replace the watcher construction block with:

```ts
const creditFile = creditFileAddressOptional();
const watcher = creditFile
  ? new ChainWatcher(
      creditFile,
      () => agentRepo.list(true).map((a) => a.address),
      uw.earningsWindowSecs,
      uw.pollIntervalMs,
      store,
    )
  : null;
```

Replace the agents router registration so it reports real earnings:

```ts
app.use("/api/agents", createAgentsRouter(agentRepo, () => watcher?.perAgentEarnings() ?? {}));
```

Seed the registry from the seller address if it is empty, immediately before `watcher?.start()`:

```ts
if (agentRepo.list().length === 0) {
  agentRepo.upsert({ address: seller.address, name: "price", kind: "price", active: true });
  console.log(`[underwriter] seeded agent registry with ${seller.address}`);
}
```

- [ ] **Step 8: Run tests and typecheck**

Run: `cd apps/underwriter && pnpm test && ../../node_modules/.bin/tsc --noEmit --pretty false`
Expected: PASS — 23 tests, no type errors

- [ ] **Step 9: Commit**

```bash
git add apps/underwriter/src/treasury.ts apps/underwriter/src/watcher.ts apps/underwriter/src/state.ts apps/underwriter/src/index.ts apps/underwriter/test/treasury.test.ts packages/shared/src/types.ts
git commit -m "feat: multi-agent watcher pooling earnings with union payer diversity"
```

---

## Task 5: Multi-service seller

**Files:**
- Create: `apps/seller-agent/src/services.ts`
- Modify: `apps/seller-agent/src/index.ts` (full rewrite)
- Modify: `packages/shared/src/config.ts` (add `agentsConfig`)
- Modify: `.env.example`

**Interfaces:**
- Consumes: `ReceiptRecorder` (existing, unchanged), `lookupPrice` (existing)
- Produces:
  - `interface ServiceDef { key: string; route: string; priceMicro: bigint; privateKey: \`0x${string}\`; address: \`0x${string}\`; handler: (req: Request) => unknown }`
  - `agentsConfig(): { services: { key: string; privateKey: \`0x${string}\`; priceMicro: bigint }[] }`

- [ ] **Step 1: Add agent config with the price floor**

In `packages/shared/src/config.ts`, add:

```ts
/** USDC has 6 decimals, so nothing below 1 micro-USD can settle onchain. */
const MIN_PRICE_MICRO = 1n;

export function agentsConfig() {
  const defs = [
    { key: "price", keyVar: "AGENT_PRICE_PRIVATE_KEY", priceVar: "PRICE_MICRO_PRICE", fallback: "50000" },
    { key: "scrape", keyVar: "AGENT_SCRAPE_PRIVATE_KEY", priceVar: "PRICE_MICRO_SCRAPE", fallback: "20000" },
    { key: "shop", keyVar: "AGENT_SHOP_PRIVATE_KEY", priceVar: "PRICE_MICRO_SHOP", fallback: "100000" },
  ];

  const services = defs.map((d) => {
    const priceMicro = reqMicro(d.priceVar, d.fallback);
    if (priceMicro < MIN_PRICE_MICRO) {
      throw new Error(
        `${d.priceVar}=${priceMicro} is below the 1 micro-USD settlement floor; ` +
          `USDC has 6 decimals and cannot move less than $0.000001`,
      );
    }
    return { key: d.key, privateKey: reqPrivateKey(d.keyVar), priceMicro };
  });

  return { services };
}
```

- [ ] **Step 2: Add the env vars**

Append to `.env.example`:

```bash
# ---- earning agents --------------------------------------------------------
# Each service is a distinct onchain agent identity and needs its own funded
# wallet, because CreditFile keys receipts by msg.sender.
AGENT_PRICE_PRIVATE_KEY=
AGENT_SCRAPE_PRIVATE_KEY=
AGENT_SHOP_PRIVATE_KEY=
PRICE_MICRO_PRICE=50000
PRICE_MICRO_SCRAPE=20000
PRICE_MICRO_SHOP=100000

# ---- treasury --------------------------------------------------------------
DB_PATH=./float.db
RESERVATION_HORIZON_DAYS=35
PLANNER_INTERVAL_MS=5000
DISCRETIONARY_MERCHANTS=

# ---- biller sim ------------------------------------------------------------
BILLER_SIM_PORT=3004
```

- [ ] **Step 3: Write the service definitions**

Create `apps/seller-agent/src/services.ts`:

```ts
import type { Request } from "express";
import { lookupPrice, randomSku, serializePriceResult } from "./fixtures.js";

/** Fixture stores reused across the scrape and shop responses. */
const STORES = ["boltmart", "nimbus", "orchard", "vantage", "yardline"];

function jitterPct(): number {
  return 0.97 + Math.random() * 0.06;
}

export interface ServiceHandlerResult {
  status: number;
  body: unknown;
}

export type ServiceHandler = (req: Request) => ServiceHandlerResult;

/** Best-price lookup. Unchanged behaviour from the single-service seller. */
export const priceHandler: ServiceHandler = (req) => {
  const sku = typeof req.query.sku === "string" ? req.query.sku : "";
  const result = lookupPrice(sku);
  if (!result) return { status: 404, body: { error: "unknown sku" } };
  return { status: 200, body: serializePriceResult(result) };
};

/**
 * Fixture extraction. There is deliberately no scraper — the product is the
 * payment and credit loop, not page parsing.
 */
export const scrapeHandler: ServiceHandler = (req) => {
  const url = typeof req.query.url === "string" ? req.query.url : "";
  if (!url) return { status: 400, body: { error: "url is required" } };

  return {
    status: 200,
    body: {
      url,
      title: `Product page at ${url.replace(/^https?:\/\//, "").split("/")[0]}`,
      extracted: {
        priceMicro: String(Math.floor(20_000_000 * jitterPct())),
        inStock: Math.random() > 0.2,
        rating: Number((3.5 + Math.random() * 1.5).toFixed(1)),
      },
      fetchedAt: new Date().toISOString(),
    },
  };
};

/** Shopping shortlist across the fixture stores. */
export const shopHandler: ServiceHandler = (req) => {
  const query = typeof req.query.query === "string" ? req.query.query : "";
  if (!query) return { status: 400, body: { error: "query is required" } };

  const sku = randomSku();
  const result = lookupPrice(sku)!;

  return {
    status: 200,
    body: {
      query,
      results: STORES.slice(0, 3).map((store, i) => ({
        store,
        sku,
        priceMicro: String((result.best.priceMicro * BigInt(100 + i * 4)) / 100n),
        shipsInDays: 1 + i,
      })),
    },
  };
};

export const SERVICE_HANDLERS: Record<string, { route: string; handler: ServiceHandler }> = {
  price: { route: "/price", handler: priceHandler },
  scrape: { route: "/scrape", handler: scrapeHandler },
  shop: { route: "/shop", handler: shopHandler },
};
```

- [ ] **Step 4: Rewrite the seller to mount one route per service**

Replace the entire contents of `apps/seller-agent/src/index.ts`:

```ts
import express from "express";
import { paymentMiddleware } from "@x402/express";
import { HTTPFacilitatorClient, x402ResourceServer } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { privateKeyToAccount } from "viem/accounts";
import {
  agentsConfig,
  creditFileAddressOptional,
  formatUsdSymbol,
  sellerConfig,
  x402Config,
} from "@float/shared";
import { SERVICE_HANDLERS } from "./services.js";
import { ReceiptRecorder } from "./receipts.js";

const seller = sellerConfig();
const x402 = x402Config();
const creditFile = creditFileAddressOptional();
const { services } = agentsConfig();

const app = express();

/**
 * Each service is its own agent identity with its own wallet and its own
 * nonce-serialized receipt queue. CreditFile keys receipts by msg.sender, so
 * distinct agents require distinct wallets — writing them all from one wallet
 * would destroy the "provably earned by this agent" property.
 */
const agents = services.map((svc) => {
  const account = privateKeyToAccount(svc.privateKey);
  const spec = SERVICE_HANDLERS[svc.key];
  if (!spec) throw new Error(`No handler registered for service "${svc.key}"`);

  const recorder = creditFile
    ? new ReceiptRecorder(svc.privateKey, creditFile, seller.flushIntervalMs)
    : null;
  recorder?.start();

  return { ...svc, address: account.address, route: spec.route, handler: spec.handler, recorder };
});

const byPayTo = new Map(agents.map((a) => [a.address.toLowerCase(), a]));

const resourceServer = new x402ResourceServer(
  new HTTPFacilitatorClient({ url: x402.facilitatorUrl }),
)
  .register(x402.network, new ExactEvmScheme())
  .onAfterSettle(async (ctx) => {
    const payer = ctx.result.payer as `0x${string}` | undefined;
    const amount = ctx.result.amount;
    const payTo = (ctx.requirements.payTo as string | undefined)?.toLowerCase();
    if (!payer || amount === undefined || !payTo) return;

    // Route the receipt to the agent that was actually paid.
    const agent = byPayTo.get(payTo);
    if (!agent) return;

    const amountMicro = BigInt(amount);
    console.log(`SALE service=${agent.key} agent=${agent.address} payer=${payer} amount=${amountMicro}`);
    agent.recorder?.enqueue(payer, amountMicro);
  });

/**
 * Price is an explicit asset + atomic amount rather than a "$0.05" string. That
 * avoids the scheme's default-stablecoin lookup for Monad and keeps the
 * advertised price identical to the micro-USD integer recorded onchain.
 */
const routes = Object.fromEntries(
  agents.map((a) => [
    `GET ${a.route}`,
    {
      accepts: {
        scheme: "exact",
        network: x402.network,
        payTo: a.address,
        price: { asset: x402.assetAddress, amount: a.priceMicro.toString() },
      },
      resource: `${seller.publicUrl}${a.route}`,
      description: `${a.key} service`,
      mimeType: "application/json",
    },
  ]),
);

app.use(paymentMiddleware(routes, resourceServer));

for (const agent of agents) {
  app.get(agent.route, (req, res) => {
    const result = agent.handler(req);
    res.status(result.status).json(result.body);
  });
}

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    creditFile: creditFile ?? null,
    agents: agents.map((a) => ({
      key: a.key,
      address: a.address,
      priceMicro: a.priceMicro.toString(),
      queueDepth: a.recorder?.queueDepth ?? 0,
    })),
  });
});

app.listen(seller.port, () => {
  console.log(`[seller] :${seller.port} network=${x402.network}`);
  for (const a of agents) {
    console.log(`[seller]   ${a.route} ${formatUsdSymbol(a.priceMicro)} agent=${a.address}`);
  }
  console.log(`[seller] creditFile=${creditFile ?? "(unset — receipts not recorded yet)"}`);
});
```

- [ ] **Step 5: Typecheck**

Run: `cd apps/seller-agent && ../../node_modules/.bin/tsc --noEmit --pretty false`
Expected: no output

If `ctx.requirements.payTo` is not present on the settle context type, read the actual shape from
`node_modules/.pnpm/@x402+core@2.21.0/node_modules/@x402/core/dist/cjs/x402Client-CzZlbbXy.d.ts`
(search for `interface SettleContext` and `type PaymentRequirements`) and use the correct field. Do not cast to `any`.

- [ ] **Step 6: Generate three agent wallets**

Run from `packages/shared`:

```bash
node --input-type=module -e "import {generatePrivateKey,privateKeyToAccount} from 'viem/accounts'; for (const k of ['PRICE','SCRAPE','SHOP']) { const key=generatePrivateKey(); console.log('AGENT_'+k+'_PRIVATE_KEY='+key, '# '+privateKeyToAccount(key).address); }"
```

Paste the three keys into `.env`. **Each address needs MON for gas.** Fund all three from the Monad testnet faucet before running with a deployed contract.

- [ ] **Step 7: Verify all three routes challenge for payment**

Run: `cd apps/seller-agent && pnpm dev`
Then:

```bash
curl -s -o /dev/null -w "%{http_code} " "localhost:3001/price?sku=usb-c-cable-2m"
curl -s -o /dev/null -w "%{http_code} " "localhost:3001/scrape?url=https://example.com/p/1"
curl -s -o /dev/null -w "%{http_code}\n" "localhost:3001/shop?query=keyboard"
```

Expected: `402 402 402`

Also confirm each route advertises a different `payTo` and amount:

```bash
curl -s -i "localhost:3001/scrape?url=https://example.com/p/1" | grep -i payment-required
```

Decode the base64 value and check `payTo` matches the scrape agent and `amount` is `20000`.

- [ ] **Step 8: Commit**

```bash
git add apps/seller-agent/src packages/shared/src/config.ts .env.example
git commit -m "feat: multi-service seller with one agent identity per service"
```

---

## Task 6: Reservation planner

**Files:**
- Create: `apps/underwriter/src/planner/dueDates.ts`
- Create: `apps/underwriter/src/planner/reservations.ts`
- Create: `apps/underwriter/src/planner/index.ts`
- Create: `apps/underwriter/test/planner.test.ts`
- Modify: `packages/shared/src/types.ts` (add `Reservation`, `CoverageForecast`)

**Interfaces:**
- Consumes: `Bill` (Task 2), `BillRepo` (Task 2), `Db` (Task 1), `LimitState` from `@float/shared`
- Produces:
  - `nextDueAt(bill: Bill, now: Date): number` — epoch ms, UTC
  - `interface PlannedReservation { billId: number; merchantId: string; amountMicro: bigint; dueAt: number; status: "funded" | "partial"; toleranceBps: number }`
  - `allocate(bills: Bill[], budgetMicro: bigint, now: Date, horizonDays: number): PlannedReservation[]`
  - `class Planner { constructor(db: Db, billRepo: BillRepo, horizonDays: number); plan(budgetMicro: bigint, now?: Date): PlannedReservation[]; active(): PlannedReservation[]; consume(billId: number): void }`

- [ ] **Step 1: Write the failing test**

Create `apps/underwriter/test/planner.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { nextDueAt } from "../src/planner/dueDates.js";
import { allocate } from "../src/planner/reservations.js";
import type { Bill } from "../src/bills/types.js";

function bill(over: Partial<Bill>): Bill {
  return {
    id: 1,
    name: "Rent",
    merchantId: "mrc_landlord",
    mcc: "6513",
    amountMicro: 1_200_000_000n,
    cadence: "monthly",
    dueDay: 5,
    priority: 0,
    toleranceBps: 500,
    active: true,
    ...over,
  };
}

test("monthly due date lands on the given day this month when still ahead", () => {
  const now = new Date("2026-03-01T00:00:00Z");

  const due = new Date(nextDueAt(bill({ dueDay: 5 }), now));

  assert.equal(due.toISOString(), "2026-03-05T00:00:00.000Z");
});

test("monthly due date rolls to next month once the day has passed", () => {
  const now = new Date("2026-03-06T00:00:00Z");

  const due = new Date(nextDueAt(bill({ dueDay: 5 }), now));

  assert.equal(due.toISOString(), "2026-04-05T00:00:00.000Z");
});

test("monthly due date rolls across a year boundary", () => {
  const now = new Date("2026-12-20T00:00:00Z");

  const due = new Date(nextDueAt(bill({ dueDay: 5 }), now));

  assert.equal(due.toISOString(), "2027-01-05T00:00:00.000Z");
});

test("weekly due date finds the next matching weekday", () => {
  // 2026-03-04 is a Wednesday (day 3). Next Friday (day 5) is 2026-03-06.
  const now = new Date("2026-03-04T00:00:00Z");

  const due = new Date(nextDueAt(bill({ cadence: "weekly", dueDay: 5 }), now));

  assert.equal(due.toISOString(), "2026-03-06T00:00:00.000Z");
});

test("funds bills fully when the budget covers everything", () => {
  const now = new Date("2026-03-01T00:00:00Z");
  const bills = [
    bill({ id: 1, amountMicro: 100_000_000n, priority: 0 }),
    bill({ id: 2, amountMicro: 50_000_000n, priority: 1, merchantId: "mrc_netflix" }),
  ];

  const plan = allocate(bills, 200_000_000n, now, 35);

  assert.equal(plan.length, 2);
  assert.ok(plan.every((p) => p.status === "funded"));
});

test("funds in priority order and partially funds the last affordable bill", () => {
  const now = new Date("2026-03-01T00:00:00Z");
  const bills = [
    bill({ id: 2, amountMicro: 50_000_000n, priority: 1, merchantId: "mrc_netflix" }),
    bill({ id: 1, amountMicro: 100_000_000n, priority: 0 }),
  ];

  const plan = allocate(bills, 120_000_000n, now, 35);

  // Priority 0 gets its full 100, priority 1 gets the remaining 20.
  assert.equal(plan[0]?.billId, 1);
  assert.equal(plan[0]?.amountMicro, 100_000_000n);
  assert.equal(plan[0]?.status, "funded");

  assert.equal(plan[1]?.billId, 2);
  assert.equal(plan[1]?.amountMicro, 20_000_000n);
  assert.equal(plan[1]?.status, "partial");
});

test("a bill beyond the horizon is not reserved", () => {
  const now = new Date("2026-03-01T00:00:00Z");
  // Due in ~34 days is inside a 35-day horizon; a 3-day horizon excludes it.
  const bills = [bill({ dueDay: 4 })];

  assert.equal(allocate(bills, 10_000_000_000n, now, 35).length, 1);
  assert.equal(allocate(bills, 10_000_000_000n, now, 1).length, 0);
});

test("zero budget produces no reservations rather than zero-value ones", () => {
  const now = new Date("2026-03-01T00:00:00Z");

  const plan = allocate([bill({})], 0n, now, 35);

  assert.equal(plan.length, 0);
});

test("inactive bills are never reserved", () => {
  const now = new Date("2026-03-01T00:00:00Z");

  const plan = allocate([bill({ active: false })], 10_000_000_000n, now, 35);

  assert.equal(plan.length, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/underwriter && pnpm test`
Expected: FAIL — cannot find module `../src/planner/dueDates.js`

- [ ] **Step 3: Write due date computation**

Create `apps/underwriter/src/planner/dueDates.ts`:

```ts
import type { Bill } from "../bills/types.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Next occurrence of a bill's due date, in UTC epoch milliseconds.
 *
 * Everything is computed in UTC deliberately. A bill due "the 5th" that shifts
 * by a day depending on the server's timezone would reserve funds on the wrong
 * date, and daylight-saving transitions would make it intermittent.
 *
 * Monthly due days are capped at 28 by validation, so every month has the day
 * and there is no February clamping to get wrong.
 */
export function nextDueAt(bill: Bill, now: Date): number {
  if (bill.cadence === "monthly") {
    const candidate = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), bill.dueDay);
    if (candidate > now.getTime()) return candidate;
    return Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, bill.dueDay);
  }

  // Weekly: advance to the next matching weekday, never returning today.
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const currentDow = new Date(midnight).getUTCDay();
  let delta = (bill.dueDay - currentDow + 7) % 7;
  if (delta === 0) delta = 7;
  return midnight + delta * DAY_MS;
}
```

- [ ] **Step 4: Write the allocator**

Create `apps/underwriter/src/planner/reservations.ts`:

```ts
import type { Bill } from "../bills/types.js";
import { nextDueAt } from "./dueDates.js";

export interface PlannedReservation {
  billId: number;
  merchantId: string;
  amountMicro: bigint;
  dueAt: number;
  status: "funded" | "partial";
  toleranceBps: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Deterministically reserve budget against bills due inside the horizon.
 *
 * Partial funding is intentional. A bill the treasury cannot fully cover gets
 * whatever is left rather than being skipped, because "rent is 60% covered" is
 * exactly the fact the user needs to see. Silently skipping it would hide the
 * shortfall until the charge declined.
 */
export function allocate(
  bills: Bill[],
  budgetMicro: bigint,
  now: Date,
  horizonDays: number,
): PlannedReservation[] {
  const horizonEnd = now.getTime() + horizonDays * DAY_MS;

  const candidates = bills
    .filter((b) => b.active)
    .map((b) => ({ bill: b, dueAt: nextDueAt(b, now) }))
    .filter((c) => c.dueAt <= horizonEnd)
    .sort((a, b) => a.bill.priority - b.bill.priority || a.dueAt - b.dueAt);

  const plan: PlannedReservation[] = [];
  let remaining = budgetMicro;

  for (const { bill, dueAt } of candidates) {
    if (remaining <= 0n) break;

    const grant = bill.amountMicro < remaining ? bill.amountMicro : remaining;
    remaining -= grant;

    plan.push({
      billId: bill.id,
      merchantId: bill.merchantId,
      amountMicro: grant,
      dueAt,
      status: grant === bill.amountMicro ? "funded" : "partial",
      toleranceBps: bill.toleranceBps,
    });
  }

  return plan;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/underwriter && pnpm test`
Expected: PASS — 32 tests

- [ ] **Step 6: Add the shared reservation types**

Append to `packages/shared/src/types.ts`:

```ts
/** Whether projected income covers a bill by the time it is due. */
export interface CoverageForecast {
  billId: number;
  name: string;
  dueAt: number;
  /** Cumulative obligation of this bill and everything higher priority. */
  requiredMicro: bigint;
  /** Current limit plus income projected to arrive before the due date. */
  projectedMicro: bigint;
  covered: boolean;
  shortfallMicro: bigint;
}
```

The plan deliberately does **not** add a `Reservation` type to `@float/shared`. `PlannedReservation` in `planner/reservations.ts` already describes exactly this shape, and a second near-identical type in a second module is how the two drift apart.

- [ ] **Step 7: Write the planner that persists reservations**

Create `apps/underwriter/src/planner/index.ts`:

```ts
import type { Db } from "../db/index.js";
import type { BillRepo } from "../bills/repo.js";
import { allocate, type PlannedReservation } from "./reservations.js";

export { nextDueAt } from "./dueDates.js";
export { allocate, type PlannedReservation } from "./reservations.js";

/**
 * Owns the reservation table and the in-memory copy the auth path reads.
 *
 * The in-memory array is the point: matching an authorization against
 * reservations must not touch the database, because nothing on the auth path is
 * allowed to await I/O.
 */
export class Planner {
  private current: PlannedReservation[] = [];

  constructor(
    private readonly db: Db,
    private readonly billRepo: BillRepo,
    private readonly horizonDays: number,
  ) {}

  /** The reservations the auth path matches against. Synchronous, in-memory. */
  active(): PlannedReservation[] {
    return this.current;
  }

  totalReservedMicro(): bigint {
    return this.current.reduce((sum, r) => sum + r.amountMicro, 0n);
  }

  /** Recompute the whole plan from scratch and replace the persisted rows. */
  plan(budgetMicro: bigint, now = new Date()): PlannedReservation[] {
    const next = allocate(this.billRepo.list(true), budgetMicro, now, this.horizonDays);

    const unchanged =
      next.length === this.current.length &&
      next.every((r, i) => {
        const prev = this.current[i];
        return prev?.billId === r.billId && prev.amountMicro === r.amountMicro && prev.status === r.status;
      });

    this.current = next;
    if (unchanged) return next;

    // Reservations are derived state, so replacing them wholesale is simpler
    // and less error-prone than diffing. Consumed rows are kept for history.
    const tx = this.db.prepare("DELETE FROM reservations WHERE status IN ('funded','partial')");
    tx.run();

    const insert = this.db.prepare(
      `INSERT INTO reservations (bill_id, amount_micro, due_at, status, created_at)
       VALUES (?,?,?,?,?)`,
    );
    const createdAt = Date.now();
    for (const r of next) {
      insert.run(r.billId, String(r.amountMicro), r.dueAt, r.status, createdAt);
    }

    return next;
  }

  /** Mark a reservation consumed after its charge is approved. */
  consume(billId: number): void {
    this.current = this.current.filter((r) => r.billId !== billId);
    this.db
      .prepare(
        `UPDATE reservations SET status='consumed', consumed_at=?
         WHERE bill_id=? AND status IN ('funded','partial')`,
      )
      .run(Date.now(), billId);
  }
}
```

- [ ] **Step 8: Write the failing forecast test**

Append to `apps/underwriter/test/planner.test.ts`:

```ts
import { forecastCoverage } from "../src/planner/forecast.js";

test("reports a bill as covered when projected income reaches it", () => {
  const now = new Date("2026-03-01T00:00:00Z");
  // Due in 4 days. Earning 1,000,000 micro per 100s = 10,000 micro/sec,
  // so ~345,600,000 micro arrives before the due date.
  const bills = [bill({ id: 1, amountMicro: 100_000_000n, dueDay: 5 })];

  const [f] = forecastCoverage(bills, 0n, 1_000_000n, 100, now, 35);

  assert.equal(f?.covered, true);
  assert.equal(f?.shortfallMicro, 0n);
});

test("reports a shortfall when projected income falls short", () => {
  const now = new Date("2026-03-01T00:00:00Z");
  const bills = [bill({ id: 1, amountMicro: 1_000_000_000_000n, dueDay: 5 })];

  const [f] = forecastCoverage(bills, 0n, 1_000n, 100, now, 35);

  assert.equal(f?.covered, false);
  assert.ok(f!.shortfallMicro > 0n);
});

test("required amount is cumulative across priority order", () => {
  const now = new Date("2026-03-01T00:00:00Z");
  const bills = [
    bill({ id: 1, amountMicro: 100_000_000n, priority: 0, dueDay: 5 }),
    bill({ id: 2, amountMicro: 50_000_000n, priority: 1, dueDay: 5, merchantId: "mrc_netflix" }),
  ];

  const forecasts = forecastCoverage(bills, 0n, 0n, 100, now, 35);

  // The second bill must clear its own amount plus everything ahead of it.
  assert.equal(forecasts[0]?.requiredMicro, 100_000_000n);
  assert.equal(forecasts[1]?.requiredMicro, 150_000_000n);
});

test("current limit counts toward coverage even with no further income", () => {
  const now = new Date("2026-03-01T00:00:00Z");
  const bills = [bill({ id: 1, amountMicro: 100_000_000n, dueDay: 5 })];

  const [f] = forecastCoverage(bills, 100_000_000n, 0n, 100, now, 35);

  assert.equal(f?.covered, true);
});
```

- [ ] **Step 9: Run test to verify it fails**

Run: `cd apps/underwriter && pnpm test`
Expected: FAIL — cannot find module `../src/planner/forecast.js`

- [ ] **Step 10: Write the forecast**

Create `apps/underwriter/src/planner/forecast.ts`:

```ts
import type { CoverageForecast } from "@float/shared";
import type { Bill } from "../bills/types.js";
import { nextDueAt } from "./dueDates.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Project whether income will cover each upcoming bill by its due date.
 *
 * Obligations accumulate in priority order: a low-priority bill must clear its
 * own amount plus everything ahead of it, because higher-priority bills get
 * funded first. Reporting each bill against its own amount alone would show
 * everything as covered right up until the money ran out.
 *
 * @param limitMicro - credit available now
 * @param earnedInWindowMicro - earnings observed over the trailing window
 * @param earningsWindowSecs - length of that window, the rate's denominator
 */
export function forecastCoverage(
  bills: Bill[],
  limitMicro: bigint,
  earnedInWindowMicro: bigint,
  earningsWindowSecs: number,
  now: Date,
  horizonDays: number,
): CoverageForecast[] {
  const horizonEnd = now.getTime() + horizonDays * DAY_MS;

  const candidates = bills
    .filter((b) => b.active)
    .map((b) => ({ bill: b, dueAt: nextDueAt(b, now) }))
    .filter((c) => c.dueAt <= horizonEnd)
    .sort((a, b) => a.bill.priority - b.bill.priority || a.dueAt - b.dueAt);

  let cumulativeMicro = 0n;

  return candidates.map(({ bill, dueAt }) => {
    cumulativeMicro += bill.amountMicro;

    const secsUntilDue = BigInt(Math.max(0, Math.floor((dueAt - now.getTime()) / 1000)));
    const projectedIncome = (earnedInWindowMicro * secsUntilDue) / BigInt(earningsWindowSecs);
    const projectedMicro = limitMicro + projectedIncome;
    const covered = projectedMicro >= cumulativeMicro;

    return {
      billId: bill.id,
      name: bill.name,
      dueAt,
      requiredMicro: cumulativeMicro,
      projectedMicro,
      covered,
      shortfallMicro: covered ? 0n : cumulativeMicro - projectedMicro,
    };
  });
}
```

Add the re-export to `apps/underwriter/src/planner/index.ts`:

```ts
export { forecastCoverage } from "./forecast.js";
```

- [ ] **Step 11: Run tests and typecheck**

Run: `cd apps/underwriter && pnpm test && ../../node_modules/.bin/tsc --noEmit --pretty false`
Expected: PASS — 36 tests, no type errors

- [ ] **Step 12: Commit**

```bash
git add apps/underwriter/src/planner apps/underwriter/test/planner.test.ts packages/shared/src/types.ts
git commit -m "feat: reservation planner with priority funding and coverage forecast"
```

---

## Task 7: Reservation-aware authorization and per-merchant scope

**Files:**
- Modify: `apps/underwriter/src/auth.ts` (rewrite `decideAuth`)
- Modify: `apps/underwriter/src/state.ts` (reserved/discretionary split)
- Modify: `apps/underwriter/src/rain/types.ts` (`perMerchantCaps`)
- Modify: `apps/underwriter/src/rain/mock.ts` (honour caps)
- Modify: `apps/underwriter/src/index.ts` (planner loop, scope from reservations)
- Modify: `apps/underwriter/test/auth.test.ts` (extend)

**Interfaces:**
- Consumes: `Planner`, `PlannedReservation` (Task 6); `Store` (Task 4)
- Produces:
  - `Store.reservedMicro: bigint`, `Store.discretionaryMicro: bigint`, `Store.setReservations(r: PlannedReservation[]): void`
  - `decideAuth(store, req, policy, planner): AuthDecision` — signature gains `planner`
  - `CardScope.perMerchantCaps: Record<string, bigint>`

- [ ] **Step 1: Write the failing test**

Append to `apps/underwriter/test/auth.test.ts`:

```ts
import { Planner } from "../src/planner/index.js";
import { openDb } from "../src/db/index.js";
import { BillRepo } from "../src/bills/repo.js";

function plannerWithRent(amountMicro: bigint) {
  const db = openDb(":memory:");
  const bills = new BillRepo(db);
  bills.create({
    name: "Rent",
    merchantId: "mrc_landlord",
    mcc: "6513",
    amountMicro,
    cadence: "monthly",
    dueDay: 5,
    priority: 0,
    toleranceBps: 500,
  });
  return new Planner(db, bills, 35);
}

test("a reserved bill is approved even when discretionary credit is zero", () => {
  // $4 earned over 120s with 5 payers projects to $20 of limit.
  const store = storeEarning(4_000_000n, 5);
  const planner = plannerWithRent(20_000_000n);

  planner.plan(store.limitState.limitMicro);
  store.setReservations(planner.active());

  // Every cent is now reserved for rent.
  assert.equal(store.discretionaryMicro, 0n);

  const decision = decideAuth(
    store,
    { authId: "a1", amountMicro: 20_000_000n, merchantId: "mrc_landlord", mcc: "6513" },
    POLICY,
    planner,
  );

  assert.equal(decision.approved, true);
  assert.match(decision.reason, /reservation/);
});

test("an unmatched merchant cannot spend reserved funds", () => {
  const store = storeEarning(4_000_000n, 5);
  const planner = plannerWithRent(20_000_000n);
  planner.plan(store.limitState.limitMicro);
  store.setReservations(planner.active());

  const decision = decideAuth(
    store,
    { authId: "a2", amountMicro: 1_000_000n, merchantId: "mrc_random", mcc: "5734" },
    POLICY,
    planner,
  );

  assert.equal(decision.approved, false);
  assert.match(decision.reason, /insufficient/);
});

test("a biller charging above its reservation plus tolerance is declined", () => {
  const store = storeEarning(4_000_000n, 5);
  const planner = plannerWithRent(10_000_000n);
  planner.plan(store.limitState.limitMicro);
  store.setReservations(planner.active());

  // 5% tolerance on $10 allows $10.50; $12 must not pass.
  const decision = decideAuth(
    store,
    { authId: "a3", amountMicro: 12_000_000n, merchantId: "mrc_landlord", mcc: "6513" },
    POLICY,
    planner,
  );

  assert.equal(decision.approved, false);
  assert.match(decision.reason, /exceeds reservation/);
});

test("a biller charging within tolerance is approved", () => {
  const store = storeEarning(4_000_000n, 5);
  const planner = plannerWithRent(10_000_000n);
  planner.plan(store.limitState.limitMicro);
  store.setReservations(planner.active());

  const decision = decideAuth(
    store,
    { authId: "a4", amountMicro: 10_400_000n, merchantId: "mrc_landlord", mcc: "6513" },
    POLICY,
    planner,
  );

  assert.equal(decision.approved, true);
});

test("consuming a reservation leaves discretionary credit unchanged", () => {
  const store = storeEarning(4_000_000n, 5);
  const planner = plannerWithRent(10_000_000n);
  planner.plan(store.limitState.limitMicro);
  store.setReservations(planner.active());

  const before = store.discretionaryMicro;
  decideAuth(
    store,
    { authId: "a5", amountMicro: 10_000_000n, merchantId: "mrc_landlord", mcc: "6513" },
    POLICY,
    planner,
  );

  // Reserved falls by $10 and outstanding rises by $10 — they cancel.
  assert.equal(store.discretionaryMicro, before);
});
```

Also update the five existing `decideAuth(...)` calls in this file to pass a fourth argument — an empty planner:

```ts
const NO_RESERVATIONS = new Planner(openDb(":memory:"), new BillRepo(openDb(":memory:")), 35);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/underwriter && pnpm test`
Expected: FAIL — `store.setReservations is not a function`

- [ ] **Step 3: Add the reserved/discretionary split to the store**

In `apps/underwriter/src/state.ts`, add the import:

```ts
import type { PlannedReservation } from "./planner/reservations.js";
```

Add the field beside the other private fields:

```ts
  private reservations: PlannedReservation[] = [];
```

Add these members after the `availableMicro` getter:

```ts
  /** Sum of funds claimed by bill reservations. */
  get reservedMicro(): bigint {
    return this.reservations.reduce((sum, r) => sum + r.amountMicro, 0n);
  }

  /**
   * Credit available for charges that do not match a reservation. Reserved
   * money is excluded so an impulse purchase cannot consume the rent.
   */
  get discretionaryMicro(): bigint {
    const claimed = this.limit.outstandingMicro + this.reservedMicro;
    return this.limit.limitMicro > claimed ? this.limit.limitMicro - claimed : 0n;
  }

  setReservations(reservations: PlannedReservation[]): void {
    this.reservations = reservations;
  }

  /** Read-only view of the pooled profile, for the coverage forecast. */
  get pooledProfile(): PooledProfile {
    return this.profile;
  }
```

- [ ] **Step 4: Rewrite the authorization decision**

In `apps/underwriter/src/auth.ts`, replace the `decideAuth` function with:

```ts
export function decideAuth(
  store: Store,
  req: AuthRequest,
  policy: AuthPolicy,
  planner: Planner,
): AuthDecision {
  const started = process.hrtime.bigint();

  let approved: boolean;
  let reason: string;
  let matchedBillId: number | null = null;

  const reservation = planner
    .active()
    .find((r) => r.merchantId.toLowerCase() === req.merchantId.toLowerCase());

  if (!merchantAllowed(req.merchantId, policy.allowedMerchants)) {
    approved = false;
    reason = `merchant ${req.merchantId} not in scope`;
  } else if (reservation) {
    // Tolerance exists because utilities vary month to month. A biller charging
    // materially more than its bill is exactly what scope should catch.
    const ceiling =
      reservation.amountMicro + (reservation.amountMicro * BigInt(reservation.toleranceBps)) / 10_000n;

    if (req.amountMicro <= ceiling) {
      approved = true;
      matchedBillId = reservation.billId;
      reason = `approved against reservation for bill ${reservation.billId}`;
    } else {
      approved = false;
      reason =
        `exceeds reservation: ${formatUsdSymbol(req.amountMicro)} > ` +
        `${formatUsdSymbol(ceiling)} allowed for bill ${reservation.billId}`;
    }
  } else if (req.amountMicro <= store.discretionaryMicro) {
    approved = true;
    reason = `approved against ${formatUsdSymbol(store.discretionaryMicro)} of discretionary credit`;
  } else {
    approved = false;
    reason =
      `insufficient earned credit: ${formatUsdSymbol(req.amountMicro)} > ` +
      `${formatUsdSymbol(store.discretionaryMicro)} discretionary`;
  }

  if (approved) {
    // Consuming a reservation moves the same amount from reserved to
    // outstanding, so discretionary credit is unchanged by a reserved charge.
    if (matchedBillId !== null) {
      planner.consume(matchedBillId);
      store.setReservations(planner.active());
    }
    store.addOutstanding(req.amountMicro);
  }

  const elapsedMs = Number(process.hrtime.bigint() - started) / 1_000_000;

  console.log(
    `AUTH ${approved ? "APPROVED" : "DECLINED"} ${req.authId} ` +
      `amount=${formatUsdSymbol(req.amountMicro)} discretionary=${formatUsdSymbol(store.discretionaryMicro)} ` +
      `bill=${matchedBillId ?? "-"} elapsed=${elapsedMs.toFixed(2)}ms — ${reason}`,
  );

  store.emit({
    type: "auth",
    authId: req.authId,
    amountMicro: req.amountMicro.toString(),
    merchantId: req.merchantId,
    approved,
    reason,
    elapsedMs,
  });

  return { approved, reason, elapsedMs };
}
```

Add the import at the top of the file:

```ts
import type { Planner } from "./planner/index.js";
```

Update `decideWithDeadline` to take and forward the planner:

```ts
export function decideWithDeadline(
  store: Store,
  req: AuthRequest,
  policy: AuthPolicy,
  planner: Planner,
): Promise<AuthDecision> {
```

and inside it, change the call to `decideAuth(store, req, policy, planner)`.

- [ ] **Step 5: Add per-merchant caps to card scope**

In `apps/underwriter/src/rain/types.ts`, add to `CardScope`:

```ts
  /** Per-merchant ceiling in micro-USD, keyed by merchant id. */
  perMerchantCaps: Record<string, bigint>;
```

In `apps/underwriter/src/rain/mock.ts`, replace the body of `startSyntheticAuths`'s interval callback so it respects caps:

```ts
    this.timer = setInterval(() => {
      const scope = [...this.cards.values()][0]?.scope;
      const merchants = Object.keys(scope?.perMerchantCaps ?? {});

      // Prefer charging a real reserved merchant so the reservation path is
      // exercised; fall back to the discretionary merchant otherwise.
      const merchantId = merchants.length > 0 && Math.random() < 0.5
        ? merchants[Math.floor(Math.random() * merchants.length)]!
        : MERCHANT;

      const cap = scope?.perMerchantCaps[merchantId];
      const span = MAX_PURCHASE_MICRO - MIN_PURCHASE_MICRO;
      const random =
        MIN_PURCHASE_MICRO + (BigInt(Math.floor(Math.random() * 1_000_000)) * span) / 1_000_000n;
      const amountMicro = cap ?? random;

      void decide({
        authId: `mock_auth_${Date.now()}`,
        amountMicro,
        merchantId,
        mcc: MCC,
      });
    }, intervalMs);
```

- [ ] **Step 6: Wire the planner loop and derive scope from reservations**

In `apps/underwriter/src/index.ts`:

Add imports:

```ts
import { Planner } from "./planner/index.js";
```

Construct the planner after `agentRepo`:

```ts
const planner = new Planner(db, billRepo, treasury.reservationHorizonDays);
```

Replace `buildScope` with:

```ts
function buildScope(limitMicro: bigint): CardScope {
  const reservations = planner.active();

  const perMerchantCaps: Record<string, bigint> = {};
  for (const r of reservations) {
    perMerchantCaps[r.merchantId] =
      r.amountMicro + (r.amountMicro * BigInt(r.toleranceBps)) / 10_000n;
  }

  const allowedMerchants = [
    ...new Set([...reservations.map((r) => r.merchantId), ...treasury.discretionaryMerchants]),
  ];

  return {
    limitMicro,
    allowedMerchants: allowedMerchants.length > 0 ? allowedMerchants : rainCfg.allowedMerchants,
    allowedMccs: ["5734", "5732", "5943", "6513", "4900"],
    perMerchantCaps,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  };
}
```

Update both `decideWithDeadline` call sites to pass `planner` as the fourth argument — the webhook handler and the `MockRainClient.startSyntheticAuths` callback.

Start the planner loop inside `app.listen`, after `watcher?.start()`:

```ts
  setInterval(() => {
    const budget = store.limitState.limitMicro - store.limitState.outstandingMicro;
    planner.plan(budget > 0n ? budget : 0n);
    store.setReservations(planner.active());
  }, treasury.plannerIntervalMs);
```

Persist each authorization after the response is sent, inside the webhook handler after `res.json(...)`:

```ts
  db.prepare(
    `INSERT OR REPLACE INTO authorizations
     (auth_id, merchant_id, amount_micro, approved, reason, elapsed_ms, created_at)
     VALUES (?,?,?,?,?,?,?)`,
  ).run(
    parsed.authId,
    parsed.merchantId,
    String(parsed.amountMicro),
    decision.approved ? 1 : 0,
    decision.reason,
    decision.elapsedMs,
    Date.now(),
  );
```

Add a plan endpoint next to the other API routes:

```ts
app.get("/api/plan", (_req, res) => {
  const forecast = forecastCoverage(
    billRepo.list(true),
    store.limitState.limitMicro,
    store.pooledProfile.earnedInWindowMicro,
    uw.earningsWindowSecs,
    new Date(),
    treasury.reservationHorizonDays,
  );

  res.json({
    reservedMicro: store.reservedMicro.toString(),
    discretionaryMicro: store.discretionaryMicro.toString(),
    reservations: planner.active().map((r) => ({
      billId: r.billId,
      merchantId: r.merchantId,
      amountMicro: r.amountMicro.toString(),
      dueAt: r.dueAt,
      status: r.status,
    })),
    forecast: forecast.map((f) => ({
      billId: f.billId,
      name: f.name,
      dueAt: f.dueAt,
      requiredMicro: f.requiredMicro.toString(),
      projectedMicro: f.projectedMicro.toString(),
      covered: f.covered,
      shortfallMicro: f.shortfallMicro.toString(),
    })),
  });
});
```

Extend the planner import at the top of the file:

```ts
import { Planner, forecastCoverage } from "./planner/index.js";
```

- [ ] **Step 7: Run tests and typecheck**

Run: `cd apps/underwriter && pnpm test && ../../node_modules/.bin/tsc --noEmit --pretty false`
Expected: PASS — 41 tests, no type errors

Every decision in the output must show `elapsed=` under 1ms. If any exceeds 800ms the reservation lookup has become I/O-bound and Step 3's in-memory array is not being used.

- [ ] **Step 8: Commit**

```bash
git add apps/underwriter/src apps/underwriter/test/auth.test.ts
git commit -m "feat: reservation-aware authorization with per-merchant card scope"
```

---

## Task 8: Biller simulator

**Files:**
- Create: `apps/biller-sim/package.json`
- Create: `apps/biller-sim/tsconfig.json`
- Create: `apps/biller-sim/src/index.ts`
- Modify: `package.json` (root `dev` script)
- Modify: `packages/shared/src/config.ts` (add `billerSimConfig`)

**Interfaces:**
- Consumes: the underwriter's `GET /api/bills` and `POST /webhooks/rain/authorization`
- Produces: `POST /control/charge/:billId`, `POST /control/charge-excess/:billId`, `GET /health`

- [ ] **Step 1: Add the config**

In `packages/shared/src/config.ts`, add:

```ts
export function billerSimConfig() {
  return {
    port: reqInt("BILLER_SIM_PORT", 3004),
    underwriterUrl: opt("UNDERWRITER_URL", `http://localhost:${reqInt("UNDERWRITER_PORT", 3003)}`),
    webhookSecret: opt("RAIN_WEBHOOK_SECRET", ""),
    /** How often to check whether a bill has come due. */
    checkIntervalMs: reqInt("BILLER_CHECK_INTERVAL_MS", 30_000),
  };
}
```

- [ ] **Step 2: Create the package**

Create `apps/biller-sim/package.json`:

```json
{
  "name": "@float/biller-sim",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "start": "tsx src/index.ts"
  },
  "dependencies": {
    "@float/shared": "workspace:*",
    "express": "^4.21.2"
  },
  "devDependencies": {
    "@types/express": "^4.17.21"
  }
}
```

Create `apps/biller-sim/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 3: Write the simulator**

Create `apps/biller-sim/src/index.ts`:

```ts
import { createHmac } from "node:crypto";
import express from "express";
import { billerSimConfig } from "@float/shared";

const cfg = billerSimConfig();

interface RemoteBill {
  id: number;
  name: string;
  merchantId: string;
  mcc: string;
  amountMicro: string;
  cadence: string;
  dueDay: number;
  active: boolean;
}

/** Bills already charged this cycle, keyed `billId:dueAtDay`. */
const charged = new Set<string>();

async function fetchBills(): Promise<RemoteBill[]> {
  const res = await fetch(`${cfg.underwriterUrl}/api/bills?active=true`);
  if (!res.ok) throw new Error(`GET /api/bills -> ${res.status}`);
  return (await res.json()) as RemoteBill[];
}

/**
 * Charge the card the way a real biller would: post an authorization and let
 * the underwriter decide. Signed with the shared secret so the HMAC path is
 * exercised rather than bypassed.
 */
async function charge(bill: RemoteBill, amountMicro: string): Promise<{ approved: boolean; reason: string }> {
  const body = JSON.stringify({
    authId: `sim_${bill.id}_${Date.now()}`,
    amountMicro,
    merchantId: bill.merchantId,
    mcc: bill.mcc,
  });

  const headers: Record<string, string> = { "content-type": "application/json" };
  if (cfg.webhookSecret) {
    headers["x-rain-signature"] = createHmac("sha256", cfg.webhookSecret).update(body).digest("hex");
  }

  const res = await fetch(`${cfg.underwriterUrl}/webhooks/rain/authorization`, {
    method: "POST",
    headers,
    body,
  });

  const result = (await res.json()) as { approved: boolean; reason: string };
  console.log(
    `[biller] ${bill.name} $${(Number(amountMicro) / 1e6).toFixed(2)} -> ` +
      `${result.approved ? "APPROVED" : "DECLINED"} (${result.reason})`,
  );
  return result;
}

/** True when today (UTC) is the bill's due day. */
function isDueToday(bill: RemoteBill, now: Date): boolean {
  if (bill.cadence === "monthly") return now.getUTCDate() === bill.dueDay;
  return now.getUTCDay() === bill.dueDay;
}

async function tick(): Promise<void> {
  try {
    const now = new Date();
    for (const bill of await fetchBills()) {
      if (!isDueToday(bill, now)) continue;

      const key = `${bill.id}:${now.toISOString().slice(0, 10)}`;
      if (charged.has(key)) continue;
      charged.add(key);

      await charge(bill, bill.amountMicro);
    }
  } catch (err) {
    console.error(`[biller] tick failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

const app = express();

async function findBill(id: number): Promise<RemoteBill | undefined> {
  return (await fetchBills()).find((b) => b.id === id);
}

app.post("/control/charge/:billId", async (req, res) => {
  const bill = await findBill(Number(req.params.billId));
  if (!bill) {
    res.status(404).json({ error: "no such bill" });
    return;
  }
  res.json(await charge(bill, bill.amountMicro));
});

app.post("/control/charge-excess/:billId", async (req, res) => {
  const bill = await findBill(Number(req.params.billId));
  if (!bill) {
    res.status(404).json({ error: "no such bill" });
    return;
  }
  // 50% over the bill, well beyond any sane tolerance — must decline.
  const excess = String((BigInt(bill.amountMicro) * 150n) / 100n);
  res.json(await charge(bill, excess));
});

app.get("/health", (_req, res) => res.json({ ok: true, chargedThisRun: charged.size }));

app.listen(cfg.port, () => {
  console.log(`[biller] :${cfg.port} watching ${cfg.underwriterUrl}`);
  console.log(`[biller] checking due bills every ${cfg.checkIntervalMs}ms`);
  setInterval(() => void tick(), cfg.checkIntervalMs);
});
```

- [ ] **Step 4: Add it to the dev script**

In the root `package.json`, replace the `dev` script with:

```json
    "dev": "concurrently -n seller,buyers,underwriter,biller,dash -c green,yellow,cyan,blue,magenta \"pnpm -F @float/seller-agent dev\" \"pnpm -F @float/buyer-agents dev\" \"pnpm -F @float/underwriter dev\" \"pnpm -F @float/biller-sim dev\" \"pnpm -F @float/dashboard dev\"",
```

- [ ] **Step 5: Install and typecheck**

Run: `pnpm install && cd apps/biller-sim && ../../node_modules/.bin/tsc --noEmit --pretty false`
Expected: no type errors

- [ ] **Step 6: Verify the full loop by hand**

Start the underwriter and the biller sim. Then:

```bash
# Create a small bill the treasury can actually cover.
curl -s -X POST localhost:3003/api/bills -H "content-type: application/json" \
  -d '{"name":"Netflix","merchantId":"mrc_netflix","mcc":"5734","amountMicro":"15000000","cadence":"monthly","dueDay":5,"priority":0}'

# Wait one planner interval (5s), then confirm a reservation exists.
curl -s localhost:3003/api/plan

# Charge it.
curl -s -X POST localhost:3004/control/charge/1

# Charge 50% over the bill.
curl -s -X POST localhost:3004/control/charge-excess/1
```

Expected:
- `/api/plan` shows a reservation for `mrc_netflix`. With zero earnings it is `partial` with `amountMicro: "0"` — no reservation is created at all, so the charge falls through to the discretionary path and declines. That is correct at zero income.
- With earnings flowing (buyers running against a deployed contract), the reservation becomes `funded`, `/control/charge/1` returns `approved: true` with a reason naming the bill, and `/control/charge-excess/1` returns `approved: false` with `exceeds reservation`.

- [ ] **Step 7: Commit**

```bash
git add apps/biller-sim package.json packages/shared/src/config.ts
git commit -m "feat: biller simulator driving charges through the real webhook"
```

---

## Verification

After Task 8, the backend is complete. Full-system check:

```bash
pnpm install
pnpm contracts:build
pnpm contracts:deploy          # paste CREDIT_FILE_ADDRESS into .env
pnpm contracts:test
pnpm -F @float/underwriter test   # 41 tests
pnpm dev
curl -X POST localhost:3002/control/start
```

Then confirm, in order:

1. `GET /api/agents` lists three agents with rising `totalEarnedMicro`.
2. `GET /api/state` shows `limitMicro` climbing.
3. `GET /api/plan` shows reservations moving from `partial` to `funded` as earnings accumulate.
4. `POST localhost:3004/control/charge/<id>` approves and names the bill.
5. `POST localhost:3004/control/charge-excess/<id>` declines with `exceeds reservation`.
6. `curl -X POST localhost:3003/api/demo/income/stop`, wait `EARNINGS_WINDOW_SECS`, and confirm reservations degrade to `partial` and a repeat charge declines.

Every `AUTH` log line must show `elapsed=` well under 800ms.

## Known gaps carried into this plan

- The chain path is **unverified as of the starting commit**. `.env` holds throwaway keys with no balance, so real x402 settlement, contract deployment, and onchain receipts have never run. Tasks 4, 5, and 8 assume it works. Verify M0.5 and M1 from the FLOAT README before starting Task 4, or those tasks will be built on an untested foundation.
- Three agent wallets each need MON for gas. Fund all three before Task 5's live verification.
- `LiveRainClient` still has an unconfirmed request shape. `perMerchantCaps` must be mapped to Rain's real per-merchant control fields during the live probe; `MockRainClient` is authoritative until then.

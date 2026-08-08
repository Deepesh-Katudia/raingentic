import type { Db } from "../db/index.js";
import type { Bill, Cadence, NewBill } from "./types.js";
import { checkBillInvariants } from "./rules.js";

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
    return (this.db.prepare(sql).all() as unknown as BillRow[]).map(toBill);
  }

  /**
   * Task 3's PATCH endpoint validates the merged result before calling this,
   * so in practice the HTTP boundary already guards against a bad patch.
   * This check is defense-in-depth on the repo itself: any other caller —
   * present or future — that isn't that endpoint must not be able to
   * silently persist a bill that violates its own invariants (e.g.
   * patching `cadence` to "weekly" while `dueDay` stays at 25). Throws
   * rather than returning null, matching `create()`'s existing pattern of
   * throwing on a state it refuses to write.
   */
  update(id: number, patch: Partial<NewBill>): Bill | null {
    const existing = this.get(id);
    if (!existing) return null;

    const next = { ...existing, ...patch };
    const invariantError = checkBillInvariants(next);
    if (invariantError) throw new Error(`invalid bill update: ${invariantError}`);

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

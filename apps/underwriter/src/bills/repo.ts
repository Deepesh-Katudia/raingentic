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
    return (this.db.prepare(sql).all() as unknown as BillRow[]).map(toBill);
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

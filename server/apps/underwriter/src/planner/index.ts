import type { Db } from "../db/index.js";
import type { BillRepo } from "../bills/repo.js";
import { nextDueAt } from "./dueDates.js";
import { allocate, type PlannedReservation } from "./reservations.js";

export { nextDueAt } from "./dueDates.js";
export { allocate, type PlannedReservation } from "./reservations.js";
export { forecastCoverage } from "./forecast.js";

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

  /**
   * Bills already charged for their current cycle, keyed `billId:dueAt`.
   *
   * Nothing on a bill records "last paid", so without this the plan would
   * re-reserve a bill seconds after its charge was approved: `consume()` drops
   * it from memory, but the bill row is still active with the same due date. The
   * consumed reservation row is the only record that this cycle is settled, and
   * it keeps its `due_at`, so a new cycle re-reserves on its own.
   */
  private consumedCycles(): Set<string> {
    const rows = this.db
      .prepare("SELECT bill_id, due_at FROM reservations WHERE status = 'consumed'")
      .all() as unknown as { bill_id: number; due_at: number }[];

    return new Set(rows.map((r) => `${r.bill_id}:${r.due_at}`));
  }

  /** Recompute the whole plan from scratch and replace the persisted rows. */
  plan(budgetMicro: bigint, now = new Date()): PlannedReservation[] {
    const settled = this.consumedCycles();
    const bills = this.billRepo
      .list(true)
      .filter((b) => !settled.has(`${b.id}:${nextDueAt(b, now)}`));

    const next = allocate(bills, budgetMicro, now, this.horizonDays);

    // Only the persisted columns are compared. `dueAt` is one of them: when a
    // month rolls over, every other field can be identical while the stored
    // due date is a month stale.
    const unchanged =
      next.length === this.current.length &&
      next.every((r, i) => {
        const prev = this.current[i];
        return (
          prev !== undefined &&
          prev.billId === r.billId &&
          prev.amountMicro === r.amountMicro &&
          prev.dueAt === r.dueAt &&
          prev.status === r.status
        );
      });

    this.current = next;
    if (unchanged) return next;

    // Reservations are derived state, so replacing them wholesale is simpler
    // and less error-prone than diffing. Consumed rows are kept for history.
    this.db.prepare("DELETE FROM reservations WHERE status IN ('funded','partial')").run();

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

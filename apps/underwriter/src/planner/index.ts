import type { Db } from "../db/index.js";
import type { BillRepo } from "../bills/repo.js";
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

  /** Recompute the whole plan from scratch and replace the persisted rows. */
  plan(budgetMicro: bigint, now = new Date()): PlannedReservation[] {
    const next = allocate(this.billRepo.list(true), budgetMicro, now, this.horizonDays);

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

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

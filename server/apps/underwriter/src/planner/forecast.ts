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

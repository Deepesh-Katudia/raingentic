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

import type { Cadence, NewBill } from "./types.js";

/**
 * Shared range/shape invariants for a `NewBill`. Both the HTTP boundary
 * (`validate.ts`, on raw untrusted input) and the repository
 * (`repo.ts#update`, on already-typed values merged from a patch) enforce
 * these same rules, so this module is the single source of truth for what
 * "in range" means. Keeping the checks here means the two call sites cannot
 * silently drift apart — a new range rule added to one is automatically
 * available to the other.
 */

/** Monthly caps at 28 so every month has the day; no February special case. */
export const MONTHLY_MIN_DAY = 1;
export const MONTHLY_MAX_DAY = 28;
export const WEEKLY_MIN_DAY = 0;
export const WEEKLY_MAX_DAY = 6;

export const MIN_PRIORITY = 0;

export const MIN_TOLERANCE_BPS = 0;
export const MAX_TOLERANCE_BPS = 10_000;

/**
 * Upper bound on a single bill's amount, in micro-USD.
 *
 * This is a sanity ceiling for a *household bill line item*, not a
 * system-wide credit limit — it exists so an unbounded decimal string (a
 * 500-digit BigInt trivially "validates" otherwise) can't slip through and
 * later corrupt reservation allocation math, which sums `Bill.amountMicro`
 * directly. $1,000,000/mo covers even an outsized mortgage or lease payment
 * with headroom; anything above that on a single recurring bill is far more
 * likely to be bad input (unit confusion, a typo, a malicious payload) than
 * a legitimate household expense.
 */
export const MAX_AMOUNT_MICRO = 1_000_000_000_000n; // $1,000,000.00

/**
 * String length caps. These are generous — well beyond any real merchant
 * name or ID — and exist only to stop multi-megabyte strings from being
 * accepted and persisted as a "name". MCC is capped at its real-world width:
 * ISO 18245 merchant category codes are always exactly 4 digits.
 */
export const MAX_NAME_LEN = 200;
export const MAX_MERCHANT_ID_LEN = 200;
export const MAX_MCC_LEN = 4;

/** The valid due-day range for a cadence: 1..28 monthly, 0..6 weekly. */
export function dueDayRange(cadence: Cadence): { min: number; max: number } {
  return cadence === "monthly"
    ? { min: MONTHLY_MIN_DAY, max: MONTHLY_MAX_DAY }
    : { min: WEEKLY_MIN_DAY, max: WEEKLY_MAX_DAY };
}

/**
 * Validates the range/shape invariants of an already-typed `NewBill` — it
 * assumes correct JS types (string/number/bigint) and only checks that the
 * values are within bounds. Raw, untrusted input (wrong types, malformed
 * strings) is rejected earlier in `validate.ts`; this function is the
 * shared "is this in range" layer both `validate.ts` and `repo.ts#update`
 * call so a bill can never be persisted with a cadence/dueDay mismatch, an
 * unbounded amount, or an oversized string field.
 *
 * Returns an error message, or null if the bill is sound.
 */
export function checkBillInvariants(bill: NewBill): string | null {
  if (bill.name.length === 0 || bill.name.length > MAX_NAME_LEN) {
    return `name must be 1..${MAX_NAME_LEN} characters`;
  }
  if (bill.merchantId.length === 0 || bill.merchantId.length > MAX_MERCHANT_ID_LEN) {
    return `merchantId must be 1..${MAX_MERCHANT_ID_LEN} characters`;
  }
  if (bill.mcc.length === 0 || bill.mcc.length > MAX_MCC_LEN) {
    return `mcc must be 1..${MAX_MCC_LEN} characters`;
  }

  if (bill.amountMicro <= 0n || bill.amountMicro > MAX_AMOUNT_MICRO) {
    return `amountMicro must be greater than zero and at most ${MAX_AMOUNT_MICRO}`;
  }

  const { min, max } = dueDayRange(bill.cadence);
  if (bill.dueDay < min || bill.dueDay > max) {
    return `dueDay must be ${min}..${max} for ${bill.cadence}`;
  }

  if (bill.priority < MIN_PRIORITY) {
    return "priority must be a non-negative integer";
  }

  if (bill.toleranceBps < MIN_TOLERANCE_BPS || bill.toleranceBps > MAX_TOLERANCE_BPS) {
    return `toleranceBps must be ${MIN_TOLERANCE_BPS}..${MAX_TOLERANCE_BPS}`;
  }

  return null;
}

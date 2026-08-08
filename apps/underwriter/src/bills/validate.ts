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

import type { Cadence, NewBill } from "./types.js";
import { checkBillInvariants } from "./rules.js";

export type ValidationResult =
  | { ok: true; value: NewBill }
  | { ok: false; error: string };

const CADENCES: Cadence[] = ["monthly", "weekly"];

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

/**
 * Validates untrusted bill input at the HTTP boundary. Money arrives as a
 * decimal string and must be a positive integer count of micro-USD — a
 * fractional string would mean somebody did float math upstream.
 *
 * This function only checks *shape*: are the raw JSON values the right
 * JS types (string, integer number, known cadence)? Once a well-typed
 * candidate is built, `checkBillInvariants` (shared with `repo.ts#update`)
 * checks that the values are in range — upper bound on amount, string
 * length caps, and the cadence/dueDay relationship — so the two layers
 * can't drift apart.
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

  if (typeof b.cadence !== "string" || !CADENCES.includes(b.cadence as Cadence)) {
    return { ok: false, error: `cadence must be one of ${CADENCES.join(", ")}` };
  }
  const cadence = b.cadence as Cadence;

  if (typeof b.dueDay !== "number" || !Number.isInteger(b.dueDay)) {
    return { ok: false, error: "dueDay must be an integer" };
  }

  if (typeof b.priority !== "number" || !Number.isInteger(b.priority)) {
    return { ok: false, error: "priority must be an integer" };
  }

  const toleranceBps = b.toleranceBps === undefined ? 500 : b.toleranceBps;
  if (typeof toleranceBps !== "number" || !Number.isInteger(toleranceBps)) {
    return { ok: false, error: "toleranceBps must be an integer" };
  }

  const candidate: NewBill = {
    name: b.name.trim(),
    merchantId: b.merchantId.trim(),
    mcc: b.mcc.trim(),
    amountMicro,
    cadence,
    dueDay: b.dueDay,
    priority: b.priority,
    toleranceBps,
  };

  const invariantError = checkBillInvariants(candidate);
  if (invariantError) return { ok: false, error: invariantError };

  return { ok: true, value: candidate };
}

import { createHmac, timingSafeEqual } from "node:crypto";
import type { AuthDecision, AuthRequest } from "@float/shared";
import { formatUsdSymbol } from "@float/shared";
import type { Store } from "./state.js";
import type { Planner } from "./planner/index.js";

export interface AuthPolicy {
  /** Merchant ids to allow. ["*"] allows any. */
  allowedMerchants: string[];
  /** Hard deadline. Expiry declines — a hang is a failed demo. */
  timeoutMs: number;
}

function merchantAllowed(merchantId: string, allowed: string[]): boolean {
  return allowed.includes("*") || allowed.includes(merchantId);
}

/**
 * The critical path, and the entire thesis of the project.
 *
 * This reads only in-memory state. No RPC call, no Rain call, no awaited I/O of
 * any kind. The chain watcher has already made the profile fresh and the planner
 * has already published its reservations, so solvency is decided in microseconds
 * inside a ~2 second authorization window. At 15 second finality you cannot do
 * this at all — not slowly, not at all.
 *
 * A charge from a merchant with a reservation is settled against that
 * reservation; everything else competes for discretionary credit only, which is
 * what keeps a coffee from spending the rent.
 */
export function decideAuth(
  store: Store,
  req: AuthRequest,
  policy: AuthPolicy,
  planner: Planner,
): AuthDecision {
  const started = process.hrtime.bigint();

  let approved: boolean;
  let reason: string;
  let matchedBillId: number | null = null;

  const reservation = planner
    .active()
    .find((r) => r.merchantId.toLowerCase() === req.merchantId.toLowerCase());

  if (!merchantAllowed(req.merchantId, policy.allowedMerchants)) {
    approved = false;
    reason = `merchant ${req.merchantId} not in scope`;
  } else if (reservation) {
    // Tolerance exists because utilities vary month to month. A biller charging
    // materially more than its bill is exactly what scope should catch.
    const ceiling =
      reservation.amountMicro +
      (reservation.amountMicro * BigInt(reservation.toleranceBps)) / 10_000n;

    if (req.amountMicro <= ceiling) {
      approved = true;
      matchedBillId = reservation.billId;
      reason = `approved against reservation for bill ${reservation.billId}`;
    } else {
      approved = false;
      reason =
        `exceeds reservation: ${formatUsdSymbol(req.amountMicro)} > ` +
        `${formatUsdSymbol(ceiling)} allowed for bill ${reservation.billId}`;
    }
  } else if (req.amountMicro <= store.discretionaryMicro) {
    approved = true;
    reason = `approved against ${formatUsdSymbol(store.discretionaryMicro)} of discretionary credit`;
  } else {
    approved = false;
    reason =
      `insufficient earned credit: ${formatUsdSymbol(req.amountMicro)} > ` +
      `${formatUsdSymbol(store.discretionaryMicro)} discretionary`;
  }

  // Claim the funds immediately so two authorizations in flight cannot both
  // spend the same headroom.
  if (approved) {
    // Consuming a reservation moves the same amount from reserved to
    // outstanding, so discretionary credit is unchanged by a reserved charge.
    if (matchedBillId !== null) {
      planner.consume(matchedBillId);
      store.setReservations(planner.active());
    }
    store.addOutstanding(req.amountMicro);
  }

  const elapsedMs = Number(process.hrtime.bigint() - started) / 1_000_000;
  const decision: AuthDecision = { approved, reason, elapsedMs };

  console.log(
    `AUTH ${approved ? "APPROVED" : "DECLINED"} ${req.authId} ` +
      `amount=${formatUsdSymbol(req.amountMicro)} discretionary=${formatUsdSymbol(store.discretionaryMicro)} ` +
      `bill=${matchedBillId ?? "-"} elapsed=${elapsedMs.toFixed(2)}ms — ${reason}`,
  );

  store.emit({
    type: "auth",
    authId: req.authId,
    amountMicro: req.amountMicro.toString(),
    merchantId: req.merchantId,
    approved,
    reason,
    elapsedMs,
  });

  return decision;
}

/**
 * Wraps the decision in a hard deadline. The decision itself is synchronous and
 * cannot realistically exceed the timeout, but the guarantee is what matters:
 * whatever happens, this endpoint answers within the window, and an answer it
 * cannot make in time is a decline.
 */
export function decideWithDeadline(
  store: Store,
  req: AuthRequest,
  policy: AuthPolicy,
  planner: Planner,
): Promise<AuthDecision> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      console.error(`AUTH TIMEOUT ${req.authId} — declining after ${policy.timeoutMs}ms`);
      resolve({
        approved: false,
        reason: "decision deadline exceeded",
        elapsedMs: policy.timeoutMs,
      });
    }, policy.timeoutMs);

    try {
      const decision = decideAuth(store, req, policy, planner);
      clearTimeout(timer);
      resolve(decision);
    } catch (err) {
      clearTimeout(timer);
      const message = err instanceof Error ? err.message : String(err);
      console.error(`AUTH ERROR ${req.authId}: ${message}`);
      resolve({ approved: false, reason: "decision error", elapsedMs: 0 });
    }
  });
}

/**
 * The authorization endpoint is publicly reachable through a tunnel and it
 * mutates credit state, so it verifies Rain's signature. An empty secret
 * disables the check, which is only appropriate in mock mode.
 */
export function verifySignature(
  rawBody: string,
  signature: string | undefined,
  secret: string,
): boolean {
  if (!secret) return true;
  if (!signature) return false;

  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const provided = signature.replace(/^sha256=/, "");

  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(provided, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

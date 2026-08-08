import { createHmac, timingSafeEqual } from "node:crypto";
import type { AuthDecision, AuthRequest } from "@float/shared";
import { formatUsdSymbol } from "@float/shared";
import type { Store } from "./state.js";

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
 * any kind. The chain watcher has already made the profile fresh, so solvency is
 * decided in microseconds inside a ~2 second authorization window. At 15 second
 * finality you cannot do this at all — not slowly, not at all.
 */
export function decideAuth(store: Store, req: AuthRequest, policy: AuthPolicy): AuthDecision {
  const started = process.hrtime.bigint();

  const available = store.availableMicro;
  let approved: boolean;
  let reason: string;

  if (!merchantAllowed(req.merchantId, policy.allowedMerchants)) {
    approved = false;
    reason = `merchant ${req.merchantId} not in scope`;
  } else if (req.amountMicro > available) {
    approved = false;
    reason = `insufficient earned credit: ${formatUsdSymbol(req.amountMicro)} > ${formatUsdSymbol(available)} available`;
  } else {
    approved = true;
    reason = `approved against ${formatUsdSymbol(available)} of earned credit`;
  }

  // Reserve immediately so two authorizations in flight cannot both spend the
  // same headroom.
  if (approved) store.addOutstanding(req.amountMicro);

  const elapsedMs = Number(process.hrtime.bigint() - started) / 1_000_000;
  const decision: AuthDecision = { approved, reason, elapsedMs };

  console.log(
    `AUTH ${approved ? "APPROVED" : "DECLINED"} ${req.authId} ` +
      `amount=${formatUsdSymbol(req.amountMicro)} available=${formatUsdSymbol(available)} ` +
      `elapsed=${elapsedMs.toFixed(2)}ms — ${reason}`,
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
      const decision = decideAuth(store, req, policy);
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

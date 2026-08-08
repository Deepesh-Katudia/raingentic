import type { LimitState, PooledProfile } from "@float/shared";
import { subFloor0 } from "@float/shared";

export interface LimitParams {
  /** Hard ceiling on the limit regardless of how much has been earned. */
  capMicro: bigint;
}

/**
 * The limit is what the agents have actually earned, cumulatively, capped.
 *
 * This is a debit model, not a credit line: money is spendable because it was
 * already earned and recorded onchain, not because we predict more is coming.
 * It matches how the card is actually backed — spending power derives from
 * collateral, so promising more than has been banked would be writing a cheque
 * the treasury cannot cover.
 *
 * Two consequences are deliberate:
 *
 *   - **No payer-diversity discount.** Concentration is a risk to *future*
 *     income, and there is no future income in this number. Money already
 *     earned from one customer spends exactly like money earned from five.
 *     `distinctPayers` is still tracked and reported, it just does not gate
 *     spending.
 *
 *   - **No decay.** Cumulative earnings never fall, so the limit only moves
 *     down when money is spent. An agent that stops earning keeps what it
 *     already made rather than watching it evaporate.
 */
export function computeLimit(
  profile: Pick<PooledProfile, "totalEarnedMicro">,
  outstandingMicro: bigint,
  params: LimitParams,
): LimitState {
  // Reported uncapped so the dashboard can show "earned $250, capped at $200"
  // rather than silently flattening the two.
  const projectedMicro = profile.totalEarnedMicro;

  const limitMicro = projectedMicro < params.capMicro ? projectedMicro : params.capMicro;

  return {
    projectedMicro,
    limitMicro,
    outstandingMicro,
    availableMicro: subFloor0(limitMicro, outstandingMicro),
  };
}

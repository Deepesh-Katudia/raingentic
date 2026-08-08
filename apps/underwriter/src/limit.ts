import type { LimitState, Profile } from "@float/shared";
import { subFloor0 } from "@float/shared";

export interface LimitParams {
  earningsWindowSecs: number;
  horizonSecs: number;
  capMicro: bigint;
}

/** Payer diversity saturates here: five distinct payers is full credit. */
const DIVERSITY_SATURATION = 5;

/**
 * Project trailing earnings forward over the horizon, discount for payer
 * concentration, and cap.
 *
 * There is deliberately no decay logic. The trailing window empties itself when
 * income stops, so the limit falls on its own — decay is a consequence of the
 * measurement, not a separate mechanism to maintain.
 */
export function computeLimit(
  profile: Pick<Profile, "earnedInWindowMicro" | "distinctPayers">,
  outstandingMicro: bigint,
  params: LimitParams,
): LimitState {
  const projectedMicro =
    (profile.earnedInWindowMicro * BigInt(params.horizonSecs)) /
    BigInt(params.earningsWindowSecs);

  // One payer earns 50% of the projection, five or more earns 100%.
  const diversity = Math.min(profile.distinctPayers, DIVERSITY_SATURATION) / DIVERSITY_SATURATION;
  const diversityPct = BigInt(Math.round((0.5 + 0.5 * diversity) * 100));
  const adjusted = (projectedMicro * diversityPct) / 100n;

  const limitMicro = adjusted < params.capMicro ? adjusted : params.capMicro;

  return {
    projectedMicro,
    limitMicro,
    outstandingMicro,
    availableMicro: subFloor0(limitMicro, outstandingMicro),
  };
}

import type { AgentProfile, PooledProfile } from "@float/shared";

/**
 * Combine per-agent profiles into the pooled view the limit engine consumes.
 *
 * distinctPayers is the size of the union of payer sets, not the sum of
 * per-agent counts. Three agents each serving the same single customer is a
 * concentration risk, not diversity, and summing would score it as the latter.
 */
export function poolProfiles(profiles: AgentProfile[], readAt: number): PooledProfile {
  let earnedInWindowMicro = 0n;
  let totalEarnedMicro = 0n;
  const payers = new Set<string>();

  for (const p of profiles) {
    earnedInWindowMicro += p.earnedInWindowMicro;
    totalEarnedMicro += p.totalEarnedMicro;
    for (const payer of p.payers) payers.add(payer.toLowerCase());
  }

  return {
    earnedInWindowMicro,
    totalEarnedMicro,
    distinctPayers: payers.size,
    perAgent: profiles,
    readAt,
  };
}

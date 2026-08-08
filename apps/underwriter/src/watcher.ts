import { createPublicClient, http, type PublicClient } from "viem";
import { creditFileAbi, monadTestnet, type AgentProfile } from "@float/shared";
import { poolProfiles } from "./treasury.js";
import type { Store } from "./state.js";

/**
 * Keeps the pooled profile fresh so the auth path never touches the chain.
 *
 * Two mechanisms, on purpose:
 *
 *   - Polling every agent is the source of truth. It is the number the limit is
 *     computed from, and it self-corrects if an event is missed.
 *   - A ReceiptRecorded subscription drives the live feed, so the dashboard
 *     ticks the instant a receipt lands rather than up to one poll later.
 *
 * Per agent it reads getProfile for the totals and getReceipts for the payer
 * set. getProfile alone returns only a count, which cannot be unioned across
 * agents — and the union is what makes diversity honest.
 */
export class ChainWatcher {
  private readonly client: PublicClient;
  private timer: NodeJS.Timeout | null = null;
  private unwatch: (() => void) | null = null;
  private lastKey = "";
  private earnings: Record<string, string> = {};

  constructor(
    private readonly creditFile: `0x${string}`,
    private readonly agents: () => `0x${string}`[],
    private readonly windowSecs: number,
    private readonly pollIntervalMs: number,
    private readonly store: Store,
  ) {
    const chain = monadTestnet();
    this.client = createPublicClient({
      chain,
      transport: http(chain.rpcUrls.default.http[0]),
    }) as PublicClient;
  }

  /** Per-agent total earned, keyed by lowercase address, for the agents API. */
  perAgentEarnings(): Record<string, string> {
    return this.earnings;
  }

  start(): void {
    if (this.timer) return;
    void this.poll();
    this.timer = setInterval(() => void this.poll(), this.pollIntervalMs);

    // The agent set changes at runtime, so the subscription cannot be filtered
    // server-side by topic; it listens to every receipt and drops the ones for
    // agents outside the current registry.
    this.unwatch = this.client.watchContractEvent({
      address: this.creditFile,
      abi: creditFileAbi,
      eventName: "ReceiptRecorded",
      onLogs: (logs) => {
        const watched = new Set(this.agents().map((a) => a.toLowerCase()));
        for (const log of logs) {
          const a = log.args as {
            agent?: string;
            payer?: string;
            amountMicro?: bigint;
            timestamp?: bigint;
          };
          if (!a.agent || !a.payer || a.amountMicro === undefined) continue;
          if (!watched.has(a.agent.toLowerCase())) continue;

          this.store.emit({
            type: "receipt",
            payer: a.payer,
            amountMicro: a.amountMicro.toString(),
            timestamp: Number(a.timestamp ?? 0n),
          });
        }
      },
      onError: (err) => console.error(`[watcher] event subscription: ${err.message}`),
    });
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.unwatch?.();
    this.unwatch = null;
  }

  private async readAgent(address: `0x${string}`, sinceTs: bigint): Promise<AgentProfile> {
    const [earnedInWindowMicro, , totalEarned] = await this.client.readContract({
      address: this.creditFile,
      abi: creditFileAbi,
      functionName: "getProfile",
      args: [address, BigInt(this.windowSecs)],
    });

    const receipts = await this.client.readContract({
      address: this.creditFile,
      abi: creditFileAbi,
      functionName: "getReceipts",
      args: [address, sinceTs],
    });

    return {
      address,
      earnedInWindowMicro,
      totalEarnedMicro: totalEarned,
      payers: receipts.map((r) => r.payer),
    };
  }

  private async poll(): Promise<void> {
    const agents = this.agents();
    if (agents.length === 0) return;

    try {
      const sinceTs = BigInt(Math.floor(Date.now() / 1000) - this.windowSecs);
      const profiles = await Promise.all(agents.map((a) => this.readAgent(a, sinceTs)));
      const pooled = poolProfiles(profiles, Date.now());

      this.earnings = Object.fromEntries(
        profiles.map((p) => [p.address.toLowerCase(), p.totalEarnedMicro.toString()]),
      );

      // Only touch the store when something moved, otherwise every poll
      // rebroadcasts an identical limit event to the dashboard.
      const key = `${pooled.earnedInWindowMicro}:${pooled.distinctPayers}:${pooled.totalEarnedMicro}`;
      if (key === this.lastKey) return;
      this.lastKey = key;

      this.store.setProfile(pooled);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[watcher] poll failed: ${message}`);
    }
  }
}

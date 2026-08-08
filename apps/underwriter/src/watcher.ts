import { createPublicClient, http, type PublicClient } from "viem";
import { creditFileAbi, monadTestnet } from "@float/shared";
import type { Store } from "./state.js";

/**
 * Keeps the in-memory profile fresh so the auth path never has to touch the
 * chain. Two mechanisms, on purpose:
 *
 *   - A 500ms poll of getProfile is the source of truth. It is the number the
 *     limit is computed from, and it self-corrects if an event is missed.
 *   - A ReceiptRecorded event subscription drives the live feed, so the
 *     dashboard ticks the instant a receipt lands rather than up to 500ms later.
 */
export class ChainWatcher {
  private readonly client: PublicClient;
  private timer: NodeJS.Timeout | null = null;
  private unwatch: (() => void) | null = null;
  private lastKey = "";

  constructor(
    private readonly creditFile: `0x${string}`,
    private readonly agent: `0x${string}`,
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

  start(): void {
    if (this.timer) return;
    void this.poll();
    this.timer = setInterval(() => void this.poll(), this.pollIntervalMs);

    this.unwatch = this.client.watchContractEvent({
      address: this.creditFile,
      abi: creditFileAbi,
      eventName: "ReceiptRecorded",
      args: { agent: this.agent },
      onLogs: (logs) => {
        for (const log of logs) {
          const a = log.args as { payer?: string; amountMicro?: bigint; timestamp?: bigint };
          if (!a.payer || a.amountMicro === undefined) continue;
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

  private async poll(): Promise<void> {
    try {
      const [earnedInWindowMicro, distinctPayers, totalEarned] = await this.client.readContract({
        address: this.creditFile,
        abi: creditFileAbi,
        functionName: "getProfile",
        args: [this.agent, BigInt(this.windowSecs)],
      });

      // Only touch the store when something actually moved — otherwise every
      // poll would rebroadcast an identical limit event to the dashboard.
      const key = `${earnedInWindowMicro}:${distinctPayers}:${totalEarned}`;
      if (key === this.lastKey) return;
      this.lastKey = key;

      this.store.setProfile({
        earnedInWindowMicro,
        distinctPayers,
        totalEarnedMicro: totalEarned,
        readAt: Date.now(),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[watcher] poll failed: ${message}`);
    }
  }
}

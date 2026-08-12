import { createPublicClient, createWalletClient, http, type Hash } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { creditFileAbi, monadTestnet } from "@float/shared";

interface PendingReceipt {
  payer: `0x${string}`;
  amountMicro: bigint;
}

/** Never build a single tx larger than this many receipts. */
const MAX_BATCH = 100;

/**
 * Serializes every onchain write behind one queue with a locally-tracked nonce,
 * and batches the queue on an interval.
 *
 * Two problems are being solved at once. Nonce races: at demo rate the seller
 * would otherwise fire ~9 concurrent transactions per second from one EOA and
 * the RPC would hand out the same nonce repeatedly. Transaction volume: batching
 * turns those 9 tx/sec into ~2 tx/sec.
 *
 * Exactly one transaction is in flight at a time. We await submission, not
 * confirmation — the HTTP response never waits on any of this.
 */
export class ReceiptRecorder {
  private pending: PendingReceipt[] = [];
  private flushing = false;
  private nonce: number | null = null;
  private timer: NodeJS.Timeout | null = null;

  private readonly account;
  private readonly wallet;
  private readonly publicClient;

  constructor(
    privateKey: `0x${string}`,
    private readonly creditFile: `0x${string}`,
    private readonly flushIntervalMs: number,
    private readonly onRecorded?: (count: number, txHash: Hash) => void,
  ) {
    const chain = monadTestnet();
    this.account = privateKeyToAccount(privateKey);
    const transport = http(chain.rpcUrls.default.http[0]);
    this.wallet = createWalletClient({ account: this.account, chain, transport });
    this.publicClient = createPublicClient({ chain, transport });
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.flush(), this.flushIntervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Fire-and-forget. Called from the request path; must never throw or block. */
  enqueue(payer: `0x${string}`, amountMicro: bigint): void {
    this.pending.push({ payer, amountMicro });
  }

  get queueDepth(): number {
    return this.pending.length;
  }

  private async nextNonce(): Promise<number> {
    if (this.nonce === null) {
      this.nonce = await this.publicClient.getTransactionCount({
        address: this.account.address,
        blockTag: "pending",
      });
    }
    return this.nonce;
  }

  private async flush(): Promise<void> {
    if (this.flushing || this.pending.length === 0) return;
    this.flushing = true;

    // Take the batch out of the queue up front so new receipts arriving during
    // the await land in the next flush rather than being lost or double-sent.
    const batch = this.pending.splice(0, MAX_BATCH);

    try {
      const nonce = await this.nextNonce();
      const txHash = await this.wallet.writeContract({
        address: this.creditFile,
        abi: creditFileAbi,
        functionName: "recordReceiptBatch",
        args: [batch.map((r) => r.payer), batch.map((r) => r.amountMicro)],
        nonce,
      });

      this.nonce = nonce + 1;
      this.onRecorded?.(batch.length, txHash);
      console.log(`BATCH n=${batch.length} nonce=${nonce} tx=${txHash}`);
    } catch (err) {
      // Put the batch back at the front so no earnings are silently dropped,
      // and resync the nonce — the usual cause is drift after an RPC hiccup.
      this.pending.unshift(...batch);
      this.nonce = null;
      const message = err instanceof Error ? err.message : String(err);
      console.error(`BATCH FAILED n=${batch.length} requeued: ${message}`);
    } finally {
      this.flushing = false;
    }
  }
}

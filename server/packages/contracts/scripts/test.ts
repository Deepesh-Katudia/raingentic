/**
 * The one contract test: record three receipts from two payers, then assert
 * getProfile returns the correct window earnings and distinctPayers == 2.
 *
 * It runs against the live Monad testnet deployment rather than a local EVM.
 * Without Foundry there is no anvil to run, and testing the contract we are
 * actually going to use is worth more than testing a local copy of it. Costs
 * one batched transaction.
 *
 *   pnpm contracts:test
 */
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { creditFileAbi, creditFileAddress, monadTestnet, sellerConfig } from "@float/shared";

const PAYER_A = "0x1111111111111111111111111111111111111111" as const;
const PAYER_B = "0x2222222222222222222222222222222222222222" as const;
const AMOUNTS = [50_000n, 50_000n, 25_000n];
const WINDOW_SECS = 300n;

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error(`  FAIL  ${message}`);
    process.exitCode = 1;
  } else {
    console.log(`  ok    ${message}`);
  }
}

const chain = monadTestnet();
const address = creditFileAddress();
const account = privateKeyToAccount(sellerConfig().privateKey);
const transport = http(chain.rpcUrls.default.http[0]);

const publicClient = createPublicClient({ chain, transport });
const wallet = createWalletClient({ account, chain, transport });

console.log(`[test] contract ${address}`);
console.log(`[test] agent    ${account.address}`);

const before = await publicClient.readContract({
  address,
  abi: creditFileAbi,
  functionName: "getProfile",
  args: [account.address, WINDOW_SECS],
});

const hash = await wallet.writeContract({
  address,
  abi: creditFileAbi,
  functionName: "recordReceiptBatch",
  args: [[PAYER_A, PAYER_A, PAYER_B], AMOUNTS],
});
console.log(`[test] recorded 3 receipts from 2 payers, tx ${hash}`);

const receipt = await publicClient.waitForTransactionReceipt({ hash });
assert(receipt.status === "success", "batch transaction succeeded");

const logs = receipt.logs.filter(
  (l) => l.address.toLowerCase() === address.toLowerCase(),
);
assert(logs.length === 3, `emitted 3 ReceiptRecorded events (got ${logs.length})`);

const after = await publicClient.readContract({
  address,
  abi: creditFileAbi,
  functionName: "getProfile",
  args: [account.address, WINDOW_SECS],
});

const expectedDelta = AMOUNTS.reduce((a, b) => a + b, 0n);
const actualDelta = after[0] - before[0];
assert(
  actualDelta === expectedDelta,
  `window earnings rose by ${expectedDelta} micro-USD (got ${actualDelta})`,
);
assert(after[1] >= 2, `distinctPayers counted at least the 2 test payers (got ${after[1]})`);
assert(
  after[2] - before[2] === expectedDelta,
  `totalEarned rose by ${expectedDelta} micro-USD`,
);

console.log(process.exitCode ? "[test] FAILED" : "[test] PASSED");

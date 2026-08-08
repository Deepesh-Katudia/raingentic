/**
 * Deploy CreditFile to Monad testnet and print the address to paste into .env.
 *
 *   pnpm contracts:deploy
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, formatEther, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monadTestnet, sellerConfig } from "@float/shared";

const here = dirname(fileURLToPath(import.meta.url));
const artifactPath = join(here, "..", "out", "CreditFile.json");

let artifact: { abi: unknown[]; bytecode: `0x${string}` };
try {
  artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
} catch {
  console.error("[deploy] No artifact. Run `pnpm contracts:build` first.");
  process.exit(1);
}

const chain = monadTestnet();
const { privateKey } = sellerConfig();
const account = privateKeyToAccount(privateKey);
const transport = http(chain.rpcUrls.default.http[0]);

const publicClient = createPublicClient({ chain, transport });
const wallet = createWalletClient({ account, chain, transport });

const balance = await publicClient.getBalance({ address: account.address });
console.log(`[deploy] deployer ${account.address}`);
console.log(`[deploy] balance  ${formatEther(balance)} MON`);
if (balance === 0n) {
  console.error("[deploy] Deployer has no MON. Fund it from the Monad testnet faucet.");
  process.exit(1);
}

const hash = await wallet.deployContract({
  abi: artifact.abi as never,
  bytecode: artifact.bytecode,
  args: [],
});
console.log(`[deploy] tx ${hash}`);

const receipt = await publicClient.waitForTransactionReceipt({ hash });
if (receipt.status !== "success" || !receipt.contractAddress) {
  console.error(`[deploy] FAILED status=${receipt.status}`);
  process.exit(1);
}

console.log(`[deploy] deployed in block ${receipt.blockNumber}, gas ${receipt.gasUsed}`);
console.log("");
console.log(`  CREDIT_FILE_ADDRESS=${receipt.contractAddress}`);
console.log("");
console.log("[deploy] Paste that into .env, then restart the seller.");

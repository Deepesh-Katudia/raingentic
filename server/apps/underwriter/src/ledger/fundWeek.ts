import { createPublicClient, createWalletClient, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { creditFileAbi, monadTestnet } from "@float/shared";

const erc20TransferAbi = parseAbi(["function transfer(address to, uint256 amount) returns (bool)"]);

export interface FundWeekResult {
  transferTxHash: `0x${string}`;
  receiptTxHash: `0x${string}`;
}

/**
 * Moves real testnet USDC from the buyer wallet to the seller wallet, then has
 * the seller self-attest the receipt on CreditFile. Two separate real
 * transactions on purpose — CreditFile.recordReceipt never verifies a transfer
 * happened, so logging it truthfully requires doing the transfer first.
 */
export async function fundWeek(params: {
  buyerPrivateKey: `0x${string}`;
  sellerPrivateKey: `0x${string}`;
  creditFile: `0x${string}`;
  usdcAddress: `0x${string}`;
  amountMicro: bigint;
}): Promise<FundWeekResult> {
  const chain = monadTestnet();
  const transport = http(chain.rpcUrls.default.http[0]);
  const publicClient = createPublicClient({ chain, transport });

  const buyer = privateKeyToAccount(params.buyerPrivateKey);
  const seller = privateKeyToAccount(params.sellerPrivateKey);
  const buyerWallet = createWalletClient({ account: buyer, chain, transport });
  const sellerWallet = createWalletClient({ account: seller, chain, transport });

  const transferTxHash = await buyerWallet.writeContract({
    address: params.usdcAddress,
    abi: erc20TransferAbi,
    functionName: "transfer",
    args: [seller.address, params.amountMicro],
  });
  const transferReceipt = await publicClient.waitForTransactionReceipt({ hash: transferTxHash });
  if (transferReceipt.status !== "success") {
    throw new Error(`USDC transfer failed: ${transferTxHash}`);
  }

  const receiptTxHash = await sellerWallet.writeContract({
    address: params.creditFile,
    abi: creditFileAbi,
    functionName: "recordReceipt",
    args: [buyer.address, params.amountMicro],
  });
  const receiptReceipt = await publicClient.waitForTransactionReceipt({ hash: receiptTxHash });
  if (receiptReceipt.status !== "success") {
    throw new Error(`recordReceipt failed: ${receiptTxHash}`);
  }

  return { transferTxHash, receiptTxHash };
}

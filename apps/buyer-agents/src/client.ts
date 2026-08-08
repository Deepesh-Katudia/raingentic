import { createPublicClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { x402Client } from "@x402/core/client";
import { wrapFetchWithPayment } from "@x402/fetch";
import { ExactEvmScheme, toClientEvmSigner } from "@x402/evm";
import { monadTestnet, x402Config } from "@float/shared";

export interface Buyer {
  address: `0x${string}`;
  fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}

/**
 * Build a paying buyer. The wrapped fetch transparently handles the 402: it
 * makes the request, reads the payment requirements, signs an EIP-3009
 * authorization for the exact amount, and retries with the payment header.
 */
export function createBuyer(privateKey: `0x${string}`): Buyer {
  const chain = monadTestnet();
  const { network } = x402Config();

  const account = privateKeyToAccount(privateKey);
  const publicClient = createPublicClient({ chain, transport: http(chain.rpcUrls.default.http[0]) });
  const signer = toClientEvmSigner(account, publicClient);

  const client = new x402Client().register(network, new ExactEvmScheme(signer));

  return {
    address: account.address,
    fetch: wrapFetchWithPayment(fetch, client),
  };
}

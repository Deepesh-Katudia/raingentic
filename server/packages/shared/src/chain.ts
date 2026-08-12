import { defineChain } from "viem";
import { chainConfig } from "./config.js";

/**
 * Monad testnet as a viem chain. Built from env so the RPC and chain id stay in
 * one place, and so a chain id change does not require a code edit.
 */
export function monadTestnet() {
  const { rpcUrl, chainId } = chainConfig();
  return defineChain({
    id: chainId,
    name: "Monad Testnet",
    nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
    testnet: true,
  });
}

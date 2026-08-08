/**
 * M0.5 — prove one paid call end to end against the Monad facilitator before
 * anything else is built. This is the riskiest unknown in the stack, so it runs
 * first and on its own: no contract, no underwriter, no dashboard.
 *
 *   pnpm smoke:x402
 */
import { buyersConfig, formatUsdSymbol, x402Config } from "@float/shared";
import { createBuyer } from "./client.js";

async function main() {
  const buyers = buyersConfig();
  const x402 = x402Config();

  const key = buyers.privateKeys[0];
  if (!key) throw new Error("No buyer private keys configured");

  const buyer = createBuyer(key);
  const url = `${buyers.sellerUrl}/price?sku=usb-c-cable-2m`;

  console.log(`[smoke] buyer   ${buyer.address}`);
  console.log(`[smoke] network ${x402.network}`);
  console.log(`[smoke] price   ${formatUsdSymbol(x402.pricePerCallMicro)}`);
  console.log(`[smoke] GET     ${url}`);

  const started = Date.now();
  const res = await buyer.fetch(url);
  const elapsed = Date.now() - started;

  const body = await res.text();
  console.log(`[smoke] status  ${res.status} in ${elapsed}ms`);
  console.log(`[smoke] body    ${body}`);

  const paymentResponse = res.headers.get("x-payment-response");
  if (paymentResponse) console.log(`[smoke] x-payment-response ${paymentResponse}`);

  if (res.status !== 200) {
    console.error("[smoke] FAILED — expected 200 after payment");
    process.exit(1);
  }
  console.log("[smoke] OK — one paid call settled end to end");
}

main().catch((err) => {
  console.error("[smoke] ERROR", err);
  process.exit(1);
});

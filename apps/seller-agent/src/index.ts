import express from "express";
import { paymentMiddleware } from "@x402/express";
import { HTTPFacilitatorClient, x402ResourceServer } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import {
  creditFileAddressOptional,
  formatUsdSymbol,
  sellerConfig,
  x402Config,
} from "@float/shared";
import { lookupPrice, serializePriceResult, SKUS } from "./fixtures.js";
import { ReceiptRecorder } from "./receipts.js";

const seller = sellerConfig();
const x402 = x402Config();
const creditFile = creditFileAddressOptional();

// The recorder is optional so the x402 path can be proven before the contract
// exists. Once CREDIT_FILE_ADDRESS is set, receipts start landing onchain.
const recorder = creditFile
  ? new ReceiptRecorder(seller.privateKey, creditFile, seller.flushIntervalMs)
  : null;
recorder?.start();

const app = express();

const resourceServer = new x402ResourceServer(
  new HTTPFacilitatorClient({ url: x402.facilitatorUrl }),
)
  .register(x402.network, new ExactEvmScheme())
  .onAfterSettle(async (ctx) => {
    // Settlement is confirmed at this point. Queue the receipt and return
    // immediately — the chain write happens on the flusher, off this path.
    const payer = ctx.result.payer as `0x${string}` | undefined;
    const amount = ctx.result.amount;
    if (!payer || amount === undefined) return;

    const amountMicro = BigInt(amount);
    console.log(`SALE payer=${payer} amount=${amountMicro}`);
    recorder?.enqueue(payer, amountMicro);
  });

/**
 * Price is expressed as an explicit asset + atomic amount rather than a "$0.05"
 * string. That avoids depending on the scheme's default-stablecoin lookup for
 * Monad, and keeps the advertised price identical to the micro-USD integer we
 * record onchain — USDC has 6 decimals, so the units are the same.
 */
const routes = {
  "GET /price": {
    accepts: {
      scheme: "exact",
      network: x402.network,
      payTo: seller.address,
      price: {
        asset: x402.assetAddress,
        amount: x402.pricePerCallMicro.toString(),
      },
    },
    resource: `${seller.publicUrl}/price`,
    description: "Best-price lookup across five retailers for a given SKU.",
    mimeType: "application/json",
  },
};

app.use(paymentMiddleware(routes, resourceServer));

app.get("/price", (req, res) => {
  const sku = typeof req.query.sku === "string" ? req.query.sku : "";
  const result = lookupPrice(sku);
  if (!result) {
    res.status(404).json({ error: "unknown sku", known: SKUS });
    return;
  }
  res.json(serializePriceResult(result));
});

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    creditFile: creditFile ?? null,
    queueDepth: recorder?.queueDepth ?? 0,
  });
});

app.listen(seller.port, () => {
  console.log(
    `[seller] :${seller.port} price=${formatUsdSymbol(x402.pricePerCallMicro)} ` +
      `network=${x402.network} payTo=${seller.address}`,
  );
  console.log(
    `[seller] creditFile=${creditFile ?? "(unset — receipts not recorded yet)"} ` +
      `facilitator=${x402.facilitatorUrl}`,
  );
});

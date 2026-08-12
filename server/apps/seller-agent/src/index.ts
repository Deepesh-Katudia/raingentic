import express from "express";
import { paymentMiddleware } from "@x402/express";
import { HTTPFacilitatorClient, x402ResourceServer, type RouteConfig } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { privateKeyToAccount } from "viem/accounts";
import {
  agentsConfig,
  creditFileAddressOptional,
  formatUsdSymbol,
  sellerConfig,
  x402Config,
} from "@float/shared";
import { SERVICE_HANDLERS } from "./services.js";
import { ReceiptRecorder } from "./receipts.js";

const seller = sellerConfig();
const x402 = x402Config();
const creditFile = creditFileAddressOptional();
const { services } = agentsConfig();

const app = express();

/**
 * Each service is its own agent identity with its own wallet and its own
 * nonce-serialized receipt queue. CreditFile keys receipts by msg.sender, so
 * distinct agents require distinct wallets — writing them all from one wallet
 * would destroy the "provably earned by this agent" property.
 */
const agents = services.map((svc) => {
  const account = privateKeyToAccount(svc.privateKey);
  const spec = SERVICE_HANDLERS[svc.key];
  if (!spec) throw new Error(`No handler registered for service "${svc.key}"`);

  const recorder = creditFile
    ? new ReceiptRecorder(svc.privateKey, creditFile, seller.flushIntervalMs)
    : null;
  recorder?.start();

  return { ...svc, address: account.address, route: spec.route, handler: spec.handler, recorder };
});

const byPayTo = new Map(agents.map((a) => [a.address.toLowerCase(), a]));
if (byPayTo.size !== agents.length) {
  // Two services on one wallet would silently merge into one onchain identity
  // and misattribute every receipt after the first.
  throw new Error("Two services share a wallet; give each agent its own AGENT_*_PRIVATE_KEY");
}

const resourceServer = new x402ResourceServer(
  new HTTPFacilitatorClient({ url: x402.facilitatorUrl }),
)
  .register(x402.network, new ExactEvmScheme())
  .onAfterSettle(async (ctx) => {
    const payer = ctx.result.payer as `0x${string}` | undefined;
    const amount = ctx.result.amount;
    const payTo = ctx.requirements.payTo.toLowerCase();
    if (!payer || amount === undefined || !payTo) return;

    // Route the receipt to the agent that was actually paid.
    const agent = byPayTo.get(payTo);
    if (!agent) return;

    const amountMicro = BigInt(amount);
    console.log(`SALE service=${agent.key} agent=${agent.address} payer=${payer} amount=${amountMicro}`);
    agent.recorder?.enqueue(payer, amountMicro);
  });

/**
 * Price is an explicit asset + atomic amount rather than a "$0.05" string. That
 * avoids the scheme's default-stablecoin lookup for Monad and keeps the
 * advertised price identical to the micro-USD integer recorded onchain.
 */
const routes = Object.fromEntries(
  agents.map((a): [string, RouteConfig] => [
    `GET ${a.route}`,
    {
      accepts: {
        scheme: "exact",
        network: x402.network,
        payTo: a.address,
        price: { asset: x402.assetAddress, amount: a.priceMicro.toString() },
        // Required for the client to sign the EIP-3009 authorization — the
        // scheme has no way to look up an arbitrary ERC-20's EIP-712 domain.
        extra: { name: x402.assetName, version: x402.assetVersion },
      },
      resource: `${seller.publicUrl}${a.route}`,
      description: `${a.key} service`,
      mimeType: "application/json",
      // Default is a bare {} on settlement failure (e.g. insufficient funds
      // discovered at broadcast time) — surface the real reason instead.
      settlementFailedResponseBody: (_ctx, settleResult) => ({
        contentType: "application/json",
        body: { error: settleResult.errorMessage ?? settleResult.errorReason },
      }),
    },
  ]),
);

app.use(paymentMiddleware(routes, resourceServer));

for (const agent of agents) {
  app.get(agent.route, (req, res) => {
    const result = agent.handler(req);
    res.status(result.status).json(result.body);
  });
}

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    creditFile: creditFile ?? null,
    agents: agents.map((a) => ({
      key: a.key,
      address: a.address,
      priceMicro: a.priceMicro.toString(),
      queueDepth: a.recorder?.queueDepth ?? 0,
    })),
  });
});

app.listen(seller.port, () => {
  console.log(`[seller] :${seller.port} network=${x402.network}`);
  for (const a of agents) {
    console.log(`[seller]   ${a.route} ${formatUsdSymbol(a.priceMicro)} agent=${a.address}`);
  }
  console.log(`[seller] creditFile=${creditFile ?? "(unset — receipts not recorded yet)"}`);
});

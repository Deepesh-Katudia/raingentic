import express from "express";
import { agentsConfig, buyersConfig } from "@float/shared";
import { createBuyer, type Buyer } from "./client.js";
import { randomSku } from "./skus.js";

const cfg = buyersConfig();
const buyers: Buyer[] = cfg.privateKeys.map(createBuyer);

/** The "price" service is the earning agent a chat session settles against —
 * its wallet is the one the underwriter's chain watcher tracks. */
const priceMicro = agentsConfig().services.find((s) => s.key === "price")?.priceMicro ?? 50_000n;

let running = false;
let calls = 0;
let failures = 0;

const sleepMs = Math.max(1, Math.floor(1000 / cfg.callsPerSecPerBuyer));

/**
 * One loop per buyer, each with its own wallet. They pay for real over x402;
 * this is the income faucet the whole demo depends on, and cutting it is how
 * the credit limit is made to decay on cue.
 */
async function runBuyer(buyer: Buyer, index: number): Promise<void> {
  while (true) {
    if (!running) {
      await new Promise((r) => setTimeout(r, 200));
      continue;
    }

    const started = Date.now();
    try {
      const res = await buyer.fetch(`${cfg.sellerUrl}/price?sku=${randomSku()}`);
      if (res.status === 200) {
        calls++;
        await res.text();
      } else {
        failures++;
        console.error(`[buyer${index}] status ${res.status}`);
      }
    } catch (err) {
      failures++;
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[buyer${index}] ${message}`);
    }

    const remaining = sleepMs - (Date.now() - started);
    if (remaining > 0) await new Promise((r) => setTimeout(r, remaining));
  }
}

const app = express();
app.use((_req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "content-type");
  res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  next();
});
app.use(express.json());

/**
 * Settles one chat session's real dollar total as real x402 payments. The
 * seller only advertises a fixed price per call, so an arbitrary session
 * total is paid off as repeated calls until the cumulative amount covers it —
 * rounding up to the nearest call, never under-paying. Each call settles for
 * real on Monad testnet and is picked up by the underwriter's chain watcher.
 */
app.post("/control/settle", async (req, res) => {
  const raw = (req.body as { amountMicro?: unknown })?.amountMicro;
  if (typeof raw !== "string" || !/^\d+$/.test(raw)) {
    res.status(400).json({ ok: false, error: "amountMicro must be an integer string of micro-USD" });
    return;
  }

  const amountMicro = BigInt(raw);
  if (amountMicro <= 0n) {
    res.status(400).json({ ok: false, error: "amountMicro must be positive" });
    return;
  }

  const buyer = buyers[0];
  if (!buyer) {
    res.status(503).json({ ok: false, error: "no buyer wallet configured" });
    return;
  }

  const callsNeeded = Number((amountMicro + priceMicro - 1n) / priceMicro);
  let paidMicro = 0n;
  let succeeded = 0;

  for (let i = 0; i < callsNeeded; i++) {
    try {
      const r = await buyer.fetch(`${cfg.sellerUrl}/price?sku=${randomSku()}`);
      if (r.status !== 200) {
        const body = await r.text();
        // A 402 with no reason in the body means the facilitator rejected the
        // payment at broadcast time without echoing why — in practice this is
        // the buyer wallet not holding enough MON (gas) or the x402 asset.
        const reason =
          r.status === 402 && (!body || body === "{}")
            ? "payment rejected — the buyer wallet likely isn't funded with testnet MON and the x402 asset yet"
            : `seller responded ${r.status}: ${body}`;
        throw new Error(reason);
      }
      await r.text();
      paidMicro += priceMicro;
      succeeded += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[buyers] settle failed after ${succeeded}/${callsNeeded} calls: ${message}`);
      res.status(502).json({
        ok: false,
        error: message,
        requestedMicro: amountMicro.toString(),
        paidMicro: paidMicro.toString(),
        calls: succeeded,
      });
      return;
    }
  }

  console.log(`[buyers] settled session: requested=${amountMicro} paid=${paidMicro} calls=${succeeded}`);
  res.json({
    ok: true,
    requestedMicro: amountMicro.toString(),
    paidMicro: paidMicro.toString(),
    calls: succeeded,
  });
});

app.post("/control/start", (_req, res) => {
  running = true;
  console.log("[buyers] income STARTED");
  res.json({ ok: true, running });
});

app.post("/control/stop", (_req, res) => {
  running = false;
  console.log("[buyers] income STOPPED");
  res.json({ ok: true, running });
});

app.get("/control/status", (_req, res) => res.json({ running, calls, failures, buyers: buyers.length }));
app.get("/health", (_req, res) => res.json({ ok: true, running, calls, failures }));

app.listen(cfg.controlPort, () => {
  console.log(
    `[buyers] :${cfg.controlPort} count=${buyers.length} rate=${cfg.callsPerSecPerBuyer}/s each ` +
      `(~${buyers.length * cfg.callsPerSecPerBuyer}/s total) seller=${cfg.sellerUrl}`,
  );
  for (const [i, b] of buyers.entries()) console.log(`[buyers] buyer${i} ${b.address}`);
  console.log("[buyers] idle — POST /control/start to open the faucet");

  buyers.forEach((b, i) => void runBuyer(b, i));
});

setInterval(() => {
  if (running) console.log(`[buyers] calls=${calls} failures=${failures}`);
}, 5000);

import express from "express";
import { buyersConfig } from "@float/shared";
import { createBuyer, type Buyer } from "./client.js";
import { randomSku } from "./skus.js";

const cfg = buyersConfig();
const buyers: Buyer[] = cfg.privateKeys.map(createBuyer);

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

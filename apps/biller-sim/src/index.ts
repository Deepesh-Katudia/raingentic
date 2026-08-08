import { createHmac } from "node:crypto";
import express, { type Request, type Response } from "express";
import { billerSimConfig, formatUsdSymbol } from "@float/shared";

const cfg = billerSimConfig();

interface RemoteBill {
  id: number;
  name: string;
  merchantId: string;
  mcc: string;
  amountMicro: string;
  cadence: string;
  dueDay: number;
  active: boolean;
}

/** Bills already charged this cycle, keyed `billId:dueAtDay`. */
const charged = new Set<string>();

async function fetchBills(): Promise<RemoteBill[]> {
  const res = await fetch(`${cfg.underwriterUrl}/api/bills?active=true`);
  if (!res.ok) throw new Error(`GET /api/bills -> ${res.status}`);
  return (await res.json()) as RemoteBill[];
}

/**
 * Charge the card the way a real biller would: post an authorization and let
 * the underwriter decide. Signed with the shared secret so the HMAC path is
 * exercised rather than bypassed.
 */
async function charge(bill: RemoteBill, amountMicro: bigint): Promise<{ approved: boolean; reason: string }> {
  const body = JSON.stringify({
    authId: `sim_${bill.id}_${Date.now()}`,
    amountMicro: amountMicro.toString(),
    merchantId: bill.merchantId,
    mcc: bill.mcc,
  });

  const headers: Record<string, string> = { "content-type": "application/json" };
  if (cfg.webhookSecret) {
    headers["x-rain-signature"] = createHmac("sha256", cfg.webhookSecret).update(body).digest("hex");
  }

  const res = await fetch(`${cfg.underwriterUrl}/webhooks/rain/authorization`, {
    method: "POST",
    headers,
    body,
  });

  const result = (await res.json()) as { approved: boolean; reason: string };
  console.log(
    `[biller] ${bill.name} ${formatUsdSymbol(amountMicro)} -> ` +
      `${result.approved ? "APPROVED" : "DECLINED"} (${result.reason})`,
  );
  return result;
}

/** True when today (UTC) is the bill's due day. */
function isDueToday(bill: RemoteBill, now: Date): boolean {
  if (bill.cadence === "monthly") return now.getUTCDate() === bill.dueDay;
  return now.getUTCDay() === bill.dueDay;
}

async function tick(): Promise<void> {
  try {
    const now = new Date();
    for (const bill of await fetchBills()) {
      if (!isDueToday(bill, now)) continue;

      const key = `${bill.id}:${now.toISOString().slice(0, 10)}`;
      if (charged.has(key)) continue;
      charged.add(key);

      await charge(bill, BigInt(bill.amountMicro));
    }
  } catch (err) {
    console.error(`[biller] tick failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

const app = express();

async function findBill(id: number): Promise<RemoteBill | undefined> {
  return (await fetchBills()).find((b) => b.id === id);
}

/**
 * Express 4 does not catch rejections from async handlers, so an underwriter
 * that is down would become an unhandled rejection and, on Node 22, kill the
 * process. A control endpoint failing is worth a 502, not an outage.
 */
function control(handler: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response): void => {
    handler(req, res).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[biller] ${req.method} ${req.originalUrl} failed: ${message}`);
      if (!res.headersSent) res.status(502).json({ error: message });
    });
  };
}

app.post(
  "/control/charge/:billId",
  control(async (req, res) => {
    const bill = await findBill(Number(req.params.billId));
    if (!bill) {
      res.status(404).json({ error: "no such bill" });
      return;
    }
    res.json(await charge(bill, BigInt(bill.amountMicro)));
  }),
);

app.post(
  "/control/charge-excess/:billId",
  control(async (req, res) => {
    const bill = await findBill(Number(req.params.billId));
    if (!bill) {
      res.status(404).json({ error: "no such bill" });
      return;
    }
    // 50% over the bill, well beyond any sane tolerance — must decline.
    const excess = (BigInt(bill.amountMicro) * 150n) / 100n;
    res.json(await charge(bill, excess));
  }),
);

app.get("/health", (_req, res) => res.json({ ok: true, chargedThisRun: charged.size }));

app.listen(cfg.port, () => {
  console.log(`[biller] :${cfg.port} watching ${cfg.underwriterUrl}`);
  console.log(`[biller] checking due bills every ${cfg.checkIntervalMs}ms`);
  setInterval(() => void tick(), cfg.checkIntervalMs);
});

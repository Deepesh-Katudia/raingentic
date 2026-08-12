import express from "express";
import { privateKeyToAccount } from "viem/accounts";
import {
  buyersConfig,
  buyersControlUrl,
  creditFileAddressOptional,
  formatUsdSymbol,
  rainConfig,
  sellerConfig,
  treasuryConfig,
  underwritingConfig,
  x402Config,
} from "@float/shared";
import { openDb } from "./db/index.js";
import { BillRepo } from "./bills/repo.js";
import { AgentRepo } from "./agents/repo.js";
import { createBillsRouter } from "./api/bills.js";
import { createAgentsRouter } from "./api/agents.js";
import { Planner, forecastCoverage } from "./planner/index.js";
import { Store } from "./state.js";
import { ChainWatcher } from "./watcher.js";
import { LedgerRepo } from "./ledger/repo.js";
import { fundWeek } from "./ledger/fundWeek.js";
import { decideWithDeadline, verifySignature, type AuthPolicy } from "./auth.js";
import { createRainClient, MockRainClient, parseAuthorization, type CardScope } from "./rain/index.js";

const uw = underwritingConfig();
const rainCfg = rainConfig();
const seller = sellerConfig();
const buyers = buyersConfig();
const x402 = x402Config();

const treasury = treasuryConfig();
const db = openDb(treasury.dbPath);
const billRepo = new BillRepo(db);
const agentRepo = new AgentRepo(db);
const ledgerRepo = new LedgerRepo(db);
const planner = new Planner(db, billRepo, treasury.reservationHorizonDays);

// The limit is cumulative earned money, capped — the window and horizon are
// still read from config, but only the coverage forecast uses them now.
const store = new Store({ capMicro: uw.capMicro }, ledgerRepo);

const policy: AuthPolicy = {
  allowedMerchants: rainCfg.allowedMerchants,
  timeoutMs: uw.authTimeoutMs,
};

const { client: rain, mode: rainMode } = createRainClient();

// --- card scope sync --------------------------------------------------------

/**
 * Scope follows the plan: every reserved biller is allowed up to its own
 * tolerance-adjusted ceiling, so a compromised biller cannot overcharge even
 * though the card has credit for it.
 */
function buildScope(limitMicro: bigint): CardScope {
  const reservations = planner.active();

  const perMerchantCaps: Record<string, bigint> = {};
  for (const r of reservations) {
    perMerchantCaps[r.merchantId] =
      r.amountMicro + (r.amountMicro * BigInt(r.toleranceBps)) / 10_000n;
  }

  const allowedMerchants = [
    ...new Set([...reservations.map((r) => r.merchantId), ...treasury.discretionaryMerchants]),
  ];

  return {
    limitMicro,
    allowedMerchants: allowedMerchants.length > 0 ? allowedMerchants : rainCfg.allowedMerchants,
    allowedMccs: ["5734", "5732", "5943", "6513", "4900"],
    perMerchantCaps,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  };
}

let cardId: string | null = null;
let lastSyncedMicro = 0n;
let syncTimer: NodeJS.Timeout | null = null;

/**
 * Push scope to Rain when available credit has moved enough to matter, at most
 * once every 2 seconds. The limit engine runs at 500ms; hammering a payments
 * API four times a second would be rude and would rate-limit us mid-demo.
 */
function scheduleScopeSync(): void {
  if (syncTimer || !cardId) return;
  syncTimer = setTimeout(() => {
    syncTimer = null;
    const available = store.availableMicro;
    const delta = available > lastSyncedMicro ? available - lastSyncedMicro : lastSyncedMicro - available;
    if (delta < uw.syncThresholdMicro) return;

    lastSyncedMicro = available;
    void rain
      .updateScope(cardId!, buildScope(available))
      .then(() => store.setCard({ cardId: cardId!, last4: lastLast4, limitMicro: available }))
      .catch((err) => console.error(`[rain] scope sync failed: ${err.message}`));
  }, 2000);
}

let lastLast4 = "0000";
let issuing = false;

/** Rain rejects a card whose limit rounds to less than one cent. */
const MIN_CARD_MICRO = 10_000n;

/**
 * Issue the card lazily, the first time there is actually something to scope.
 *
 * Issuing at boot sent Rain a zero limit and it replied
 * "body/limit/amount must be >= 1", which killed the process. A treasury with
 * no earnings has no card to issue yet — that is a normal state, not a failure,
 * so this waits rather than erroring, and a Rain outage degrades the service
 * instead of stopping it.
 */
async function ensureCard(): Promise<void> {
  if (cardId || issuing) return;

  const limitMicro = store.limitState.limitMicro;
  if (limitMicro < MIN_CARD_MICRO) return;

  issuing = true;
  try {
    const issued = await rain.issueCard(buildScope(limitMicro));
    cardId = issued.cardId;
    lastLast4 = issued.last4;
    lastSyncedMicro = store.availableMicro;
    store.setCard({ cardId: issued.cardId, last4: issued.last4, limitMicro });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[rain] card issuance failed, will retry: ${message}`);
  } finally {
    issuing = false;
  }
}

// --- HTTP -------------------------------------------------------------------

const app = express();
// Frontend (Vercel) and this service (Render) are on different domains —
// permissive since this is a testnet demo with no user auth to protect.
app.use((_req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "content-type");
  res.header("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
  next();
});
app.use(express.json({ verify: (req, _res, buf) => ((req as never as { rawBody: string }).rawBody = buf.toString("utf8")) }));

app.use("/api/bills", createBillsRouter(billRepo));
app.use("/api/agents", createAgentsRouter(agentRepo, () => watcher?.perAgentEarnings() ?? {}));

app.post("/webhooks/rain/authorization", async (req, res) => {
  const rawBody = (req as never as { rawBody?: string }).rawBody ?? "";
  const signature = req.header("x-rain-signature") ?? req.header("rain-signature");

  if (!verifySignature(rawBody, signature, rainCfg.webhookSecret)) {
    res.status(401).json({ approved: false, reason: "bad signature" });
    return;
  }

  const parsed = parseAuthorization(req.body);
  if (!parsed) {
    res.status(400).json({ approved: false, reason: "unparseable authorization" });
    return;
  }

  const decision = await decideWithDeadline(store, parsed, policy, planner);
  res.json({ approved: decision.approved, reason: decision.reason });

  // Deliberately after the response: the authorization window is the budget,
  // and history is worth nothing if writing it costs us the decision. The
  // catch matters for the same reason — the answer is already sent, so a failed
  // history write must not take the process down with it.
  try {
    db.prepare(
      `INSERT OR REPLACE INTO authorizations
       (auth_id, merchant_id, amount_micro, approved, reason, elapsed_ms, created_at)
       VALUES (?,?,?,?,?,?,?)`,
    ).run(
      parsed.authId,
      parsed.merchantId,
      String(parsed.amountMicro),
      decision.approved ? 1 : 0,
      decision.reason,
      decision.elapsedMs,
      Date.now(),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[underwriter] failed to persist authorization ${parsed.authId}: ${message}`);
  }
});

app.get("/api/state", (_req, res) => res.json(store.snapshot()));

/**
 * Mock Spend Agent purchases (groceries, flights, anything bought through the
 * chat) hit this so they draw down the real card balance and show up as a
 * real expense in the Ledger — same debit model as an approved card charge.
 */
app.post("/api/spend", (req, res) => {
  let amountMicro: bigint;
  try {
    amountMicro = BigInt(req.body?.amountMicro);
  } catch {
    res.status(400).json({ ok: false, error: "amountMicro must be an integer string" });
    return;
  }
  if (amountMicro <= 0n) {
    res.status(400).json({ ok: false, error: "amountMicro must be positive" });
    return;
  }

  const description = typeof req.body?.description === "string" ? req.body.description : "purchase";
  const authId = `spend_${Date.now()}`;

  store.addOutstanding(amountMicro);
  store.emit({
    type: "auth",
    authId,
    amountMicro: amountMicro.toString(),
    merchantId: description,
    approved: true,
    reason: "spend agent purchase",
    elapsedMs: 0,
  });

  res.json({ ok: true, authId });
});

/** Real transactions (settled receipts, approved card charges) at or after
 *  ?since= (epoch ms). Nothing is ever deleted — the frontend decides how
 *  much of the history to show (e.g. "this week"). */
app.get("/api/ledger", (req, res) => {
  const since = Number(req.query.since ?? 0);
  res.json(ledgerRepo.since(Number.isFinite(since) ? since : 0));
});

function startOfWeekMs(d: Date): number {
  const s = new Date(d);
  s.setHours(0, 0, 0, 0);
  s.setDate(s.getDate() - s.getDay());
  return s.getTime();
}

/**
 * Moves this week's mock frontend earnings onto the real chain: buyer wallet
 * sends real testnet USDC to the seller wallet, seller logs the receipt. One
 * real income event per week, matching the weekly-reset panel in the admin UI.
 */
app.post("/api/ledger/fund-week", async (req, res) => {
  if (!creditFile) {
    res.status(409).json({ ok: false, error: "CREDIT_FILE_ADDRESS not set — deploy the contract first" });
    return;
  }

  let amountMicro: bigint;
  try {
    amountMicro = BigInt(req.body?.amountMicro);
  } catch {
    res.status(400).json({ ok: false, error: "amountMicro must be an integer string" });
    return;
  }
  if (amountMicro <= 0n) {
    res.status(400).json({ ok: false, error: "amountMicro must be positive" });
    return;
  }

  const buyerPrivateKey = buyers.privateKeys[0];
  if (!buyerPrivateKey) {
    res.status(500).json({ ok: false, error: "no buyer wallet configured" });
    return;
  }

  try {
    const result = await fundWeek({
      buyerPrivateKey,
      sellerPrivateKey: seller.privateKey,
      creditFile,
      usdcAddress: x402.assetAddress,
      amountMicro,
    });
    // Force an immediate re-read so the card limit reflects the new balance
    // right away instead of waiting up to pollIntervalMs for the next tick.
    await watcher?.poll();
    res.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[ledger] fund-week failed: ${message}`);
    res.status(500).json({ ok: false, error: message });
  }
});

app.get("/api/plan", (_req, res) => {
  const forecast = forecastCoverage(
    billRepo.list(true),
    store.limitState.limitMicro,
    store.pooledProfile.earnedInWindowMicro,
    uw.earningsWindowSecs,
    new Date(),
    treasury.reservationHorizonDays,
  );

  res.json({
    reservedMicro: store.reservedMicro.toString(),
    discretionaryMicro: store.discretionaryMicro.toString(),
    reservations: planner.active().map((r) => ({
      billId: r.billId,
      merchantId: r.merchantId,
      amountMicro: r.amountMicro.toString(),
      dueAt: r.dueAt,
      status: r.status,
    })),
    forecast: forecast.map((f) => ({
      billId: f.billId,
      name: f.name,
      dueAt: f.dueAt,
      requiredMicro: f.requiredMicro.toString(),
      projectedMicro: f.projectedMicro.toString(),
      covered: f.covered,
      shortfallMicro: f.shortfallMicro.toString(),
    })),
  });
});

app.get("/api/stream", (req, res) => {
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.flushHeaders();
  store.addClient(res);
  req.on("close", () => store.removeClient(res));
});

app.post("/api/demo/reset", (_req, res) => {
  store.reset();
  res.json({ ok: true });
});

/**
 * Inject a simulated treasury balance so the approve path can be exercised
 * without a funded chain.
 *
 * This is NOT earned money and must never be mistaken for it. Two guards keep
 * it honest: it refuses outright once CREDIT_FILE_ADDRESS is set, so a real
 * deployment can never be silently overwritten with fabricated earnings, and
 * every call logs a warning naming itself.
 */
app.post("/api/demo/earnings", (req, res) => {
  if (creditFileAddressOptional()) {
    res.status(409).json({
      ok: false,
      error:
        "refusing to fabricate earnings while CREDIT_FILE_ADDRESS is set — " +
        "the chain is the source of truth once a contract is deployed",
    });
    return;
  }

  const raw = (req.body as { totalEarnedMicro?: unknown })?.totalEarnedMicro;
  if (typeof raw !== "string" || !/^\d+$/.test(raw)) {
    res.status(400).json({ ok: false, error: "totalEarnedMicro must be an integer string of micro-USD" });
    return;
  }

  const totalEarnedMicro = BigInt(raw);
  const distinctPayers = Number((req.body as { distinctPayers?: unknown })?.distinctPayers ?? 3);

  console.warn(
    `[underwriter] SIMULATED earnings injected: ${formatUsdSymbol(totalEarnedMicro)} — not onchain income`,
  );
  store.emit({ type: "log", level: "warn", message: `simulated earnings ${formatUsdSymbol(totalEarnedMicro)}` });

  store.setProfile({
    earnedInWindowMicro: 0n,
    totalEarnedMicro,
    distinctPayers,
    perAgent: [],
    readAt: Date.now(),
  });

  res.json({ ok: true, simulated: true, totalEarnedMicro: raw });
});

app.post("/api/demo/income/:action", async (req, res) => {
  const action = req.params.action;
  if (action !== "start" && action !== "stop") {
    res.status(400).json({ ok: false, error: "action must be start or stop" });
    return;
  }
  try {
    await fetch(`${buyersControlUrl()}/control/${action}`, { method: "POST" });
    store.setIncomeRunning(action === "start");
    store.emit({ type: "log", level: "info", message: `income ${action}ed` });
    res.json({ ok: true, action });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(502).json({ ok: false, error: message });
  }
});

app.get("/health", (_req, res) =>
  res.json({ ok: true, rainMode, cardId, available: store.availableMicro.toString() }),
);

// --- boot -------------------------------------------------------------------

// Runs without a deployed contract so the Rain loop can be exercised before M1.
// With no chain to read, earnings stay at zero and every authorization declines
// — which is demo outcome #1 anyway.
const creditFile = creditFileAddressOptional();
const watcher = creditFile
  ? new ChainWatcher(
      creditFile,
      () => agentRepo.list(true).map((a) => a.address),
      uw.earningsWindowSecs,
      uw.pollIntervalMs,
      store,
    )
  : null;

app.listen(uw.port, async () => {
  console.log(
    `[underwriter] :${uw.port} rain=${rainMode} ` +
      `creditFile=${creditFile ?? "(unset — earnings pinned at $0)"}`,
  );
  console.log(
    `[underwriter] window=${uw.earningsWindowSecs}s horizon=${uw.horizonSecs}s ` +
      `cap=${formatUsdSymbol(uw.capMicro)} authTimeout=${uw.authTimeoutMs}ms`,
  );

  // A fresh install has an empty registry, which would leave the watcher with
  // nothing to read. The seller is the one agent we always know about.
  if (agentRepo.list().length === 0) {
    agentRepo.upsert({ address: seller.address, name: "price", kind: "price", active: true });
    console.log(`[underwriter] seeded agent registry with ${seller.address}`);
  }

  watcher?.start();

  // Reservations are recomputed wholesale on every tick, so the plan tracks a
  // limit that rises with income and falls when it stops.
  setInterval(() => {
    const budget = store.limitState.limitMicro - store.limitState.outstandingMicro;
    planner.plan(budget > 0n ? budget : 0n);
    store.setReservations(planner.active());
  }, treasury.plannerIntervalMs);

  setInterval(() => {
    void ensureCard();
    scheduleScopeSync();
  }, 500);

  if (rain instanceof MockRainClient) {
    rain.startSyntheticAuths(rainCfg.mockAuthIntervalMs, (r) =>
      decideWithDeadline(store, r, policy, planner),
    );
    console.log(`[underwriter] synthetic auths every ${rainCfg.mockAuthIntervalMs}ms`);
  }
});

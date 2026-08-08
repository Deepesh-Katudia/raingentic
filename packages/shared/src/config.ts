import { config as loadDotenv } from "dotenv";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseMicro } from "./money.js";

/**
 * Find the workspace root by walking up for pnpm-workspace.yaml. Apps are
 * launched from their own package dir via `pnpm -F`, so cwd is unreliable.
 */
function findRepoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("Could not locate workspace root (no pnpm-workspace.yaml found)");
}

export const REPO_ROOT = findRepoRoot();
loadDotenv({ path: join(REPO_ROOT, ".env"), quiet: true });

// --- primitives -------------------------------------------------------------

function req(name: string): string {
  const v = process.env[name];
  if (v === undefined || v.trim() === "") {
    throw new Error(`Missing required env var: ${name}. See .env.example.`);
  }
  return v.trim();
}

function opt(name: string, fallback: string): string {
  const v = process.env[name];
  return v === undefined || v.trim() === "" ? fallback : v.trim();
}

function reqInt(name: string, fallback?: number): number {
  const raw = fallback === undefined ? req(name) : opt(name, String(fallback));
  const n = Number(raw);
  if (!Number.isInteger(n)) throw new Error(`Env var ${name} must be an integer, got "${raw}"`);
  return n;
}

function reqMicro(name: string, fallback?: string): bigint {
  return parseMicro(fallback === undefined ? req(name) : opt(name, fallback));
}

function reqAddress(name: string): `0x${string}` {
  const v = req(name);
  if (!/^0x[0-9a-fA-F]{40}$/.test(v)) throw new Error(`Env var ${name} must be a 0x address, got "${v}"`);
  return v as `0x${string}`;
}

function reqPrivateKey(name: string): `0x${string}` {
  const v = req(name);
  if (!/^0x[0-9a-fA-F]{64}$/.test(v)) throw new Error(`Env var ${name} must be a 0x-prefixed 32-byte private key`);
  return v as `0x${string}`;
}

// --- grouped config ---------------------------------------------------------
// Each group is a function so it validates only what the calling app needs.
// A missing var kills the process at startup with a named error, not later.

export function chainConfig() {
  return {
    rpcUrl: req("MONAD_RPC_URL"),
    chainId: reqInt("MONAD_CHAIN_ID", 10143),
  };
}

export function creditFileAddress(): `0x${string}` {
  return reqAddress("CREDIT_FILE_ADDRESS");
}

/**
 * Null until the contract is deployed. The seller runs without it so the x402
 * path can be proven before M1 exists; it simply skips recording receipts.
 */
export function creditFileAddressOptional(): `0x${string}` | null {
  const v = process.env.CREDIT_FILE_ADDRESS?.trim();
  if (!v) return null;
  if (!/^0x[0-9a-fA-F]{40}$/.test(v)) throw new Error(`CREDIT_FILE_ADDRESS is malformed: "${v}"`);
  return v as `0x${string}`;
}

export function sellerConfig() {
  return {
    privateKey: reqPrivateKey("SELLER_PRIVATE_KEY"),
    address: reqAddress("SELLER_ADDRESS"),
    port: reqInt("SELLER_PORT", 3001),
    /** Public URL the x402 resource is advertised as. */
    publicUrl: opt("SELLER_PUBLIC_URL", `http://localhost:${reqInt("SELLER_PORT", 3001)}`),
    /** Receipt queue flush interval — batches ~9 receipts/sec into ~2 tx/sec. */
    flushIntervalMs: reqInt("RECEIPT_FLUSH_MS", 500),
  };
}

/** CAIP-2 network id, e.g. "eip155:10143". x402 types require this shape. */
export type Caip2Network = `${string}:${string}`;

function reqCaip2(name: string, fallback: string): Caip2Network {
  const v = opt(name, fallback);
  if (!/^[^:]+:[^:]+$/.test(v)) {
    throw new Error(`Env var ${name} must be a CAIP-2 network id like "eip155:10143", got "${v}"`);
  }
  return v as Caip2Network;
}

export function x402Config() {
  return {
    network: reqCaip2("X402_NETWORK", "eip155:10143"),
    facilitatorUrl: opt("X402_FACILITATOR_URL", "https://x402-facilitator.molandak.org"),
    assetAddress: opt("X402_ASSET_ADDRESS", "0x534b2f3A21130d7a60830c2Df862319e593943A3") as `0x${string}`,
    pricePerCallMicro: reqMicro("PRICE_PER_CALL_MICRO", "50000"),
  };
}

export function underwritingConfig() {
  return {
    earningsWindowSecs: reqInt("EARNINGS_WINDOW_SECS", 120),
    horizonSecs: reqInt("HORIZON_SECS", 600),
    capMicro: reqMicro("CAP_MICRO", "200000000"),
    syncThresholdMicro: reqMicro("SYNC_THRESHOLD_MICRO", "500000"),
    pollIntervalMs: reqInt("POLL_INTERVAL_MS", 500),
    /** Hard deadline on the auth path. A timeout that declines is correct. */
    authTimeoutMs: reqInt("AUTH_TIMEOUT_MS", 800),
    port: reqInt("UNDERWRITER_PORT", 3003),
  };
}

export function treasuryConfig() {
  return {
    dbPath: opt("DB_PATH", "./float.db"),
    reservationHorizonDays: reqInt("RESERVATION_HORIZON_DAYS", 35),
    plannerIntervalMs: reqInt("PLANNER_INTERVAL_MS", 5000),
    discretionaryMerchants: opt("DISCRETIONARY_MERCHANTS", "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  };
}

export function rainConfig() {
  const mode = opt("RAIN_MODE", "mock");
  if (mode !== "mock" && mode !== "live") {
    throw new Error(`RAIN_MODE must be "mock" or "live", got "${mode}"`);
  }
  return {
    mode: mode as "mock" | "live",
    apiKey: mode === "live" ? req("RAIN_API_KEY") : opt("RAIN_API_KEY", ""),
    apiBase: mode === "live" ? req("RAIN_API_BASE") : opt("RAIN_API_BASE", ""),
    webhookSecret: opt("RAIN_WEBHOOK_SECRET", ""),
    allowedMerchants: opt("ALLOWED_MERCHANTS", "*").split(",").map((s) => s.trim()).filter(Boolean),
    /** MockRainClient fires a synthetic authorization this often. 0 disables. */
    mockAuthIntervalMs: reqInt("MOCK_AUTH_INTERVAL_MS", 12000),
  };
}

export function buyersConfig() {
  const keys = req("BUYER_PRIVATE_KEYS")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const k of keys) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(k)) throw new Error("BUYER_PRIVATE_KEYS contains a malformed key");
  }
  const count = reqInt("BUYER_COUNT", 3);
  if (keys.length < count) {
    throw new Error(`BUYER_COUNT=${count} but only ${keys.length} key(s) in BUYER_PRIVATE_KEYS`);
  }
  return {
    privateKeys: keys.slice(0, count) as `0x${string}`[],
    count,
    callsPerSecPerBuyer: reqInt("CALLS_PER_SEC_PER_BUYER", 3),
    sellerUrl: opt("SELLER_URL", `http://localhost:${reqInt("SELLER_PORT", 3001)}`),
    controlPort: reqInt("BUYER_CONTROL_PORT", 3002),
  };
}

export function buyersControlUrl(): string {
  return opt("BUYER_CONTROL_URL", `http://localhost:${reqInt("BUYER_CONTROL_PORT", 3002)}`);
}

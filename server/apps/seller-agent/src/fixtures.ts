/**
 * Hardcoded catalogue. There is deliberately no scraper — the product is the
 * payment and credit loop, not price discovery. Prices are micro-USD integers
 * so no float ever touches money, and each lookup applies +/-3% jitter so the
 * feed looks live.
 */

const STORES = ["boltmart", "nimbus", "orchard", "vantage", "yardline"] as const;

/** sku -> base price in micro-USD ($ * 1_000_000). */
const CATALOGUE: Record<string, bigint> = {
  "usb-c-cable-2m": 12_990_000n,
  "mech-keyboard-tkl": 89_000_000n,
  "noise-cancel-headphones": 249_990_000n,
  "webcam-1080p": 54_500_000n,
  "ssd-1tb-nvme": 104_990_000n,
  "monitor-27-4k": 379_000_000n,
  "desk-lamp-led": 39_990_000n,
  "laptop-stand-alu": 44_250_000n,
  "wireless-mouse": 27_990_000n,
  "hub-7port": 61_750_000n,
};

export const SKUS = Object.keys(CATALOGUE);

export interface StoreQuote {
  store: string;
  priceMicro: bigint;
}

export interface PriceResult {
  sku: string;
  best: StoreQuote;
  checked: StoreQuote[];
}

export function randomSku(): string {
  return SKUS[Math.floor(Math.random() * SKUS.length)]!;
}

/** Apply +/-3% jitter to a micro-USD price using integer math only. */
function jitter(base: bigint): bigint {
  const bps = BigInt(9700 + Math.floor(Math.random() * 601)); // 0.97x .. 1.03x
  return (base * bps) / 10_000n;
}

export function lookupPrice(sku: string): PriceResult | null {
  const base = CATALOGUE[sku];
  if (base === undefined) return null;

  // Each store gets its own baseline offset so one store is not always cheapest.
  const checked = STORES.map((store, i) => ({
    store,
    priceMicro: jitter((base * BigInt(96 + i * 2)) / 100n),
  }));

  const best = checked.reduce((a, b) => (b.priceMicro < a.priceMicro ? b : a));
  return { sku, best, checked };
}

/** Serialize micro-USD bigints to strings for JSON. */
export function serializePriceResult(r: PriceResult) {
  return {
    sku: r.sku,
    best: { store: r.best.store, priceMicro: r.best.priceMicro.toString() },
    checked: r.checked.map((c) => ({ store: c.store, priceMicro: c.priceMicro.toString() })),
  };
}

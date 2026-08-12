import type { Request } from "express";
import { lookupPrice, randomSku, serializePriceResult } from "./fixtures.js";

/** Fixture stores reused across the scrape and shop responses. */
const STORES = ["boltmart", "nimbus", "orchard", "vantage", "yardline"];

/** Apply +/-3% jitter to a micro-USD price using integer math only. */
function jitterMicro(base: bigint): bigint {
  const bps = BigInt(9700 + Math.floor(Math.random() * 601));
  return (base * bps) / 10_000n;
}

export interface ServiceHandlerResult {
  status: number;
  body: unknown;
}

export type ServiceHandler = (req: Request) => ServiceHandlerResult;

/** Best-price lookup. Unchanged behaviour from the single-service seller. */
export const priceHandler: ServiceHandler = (req) => {
  const sku = typeof req.query.sku === "string" ? req.query.sku : "";
  const result = lookupPrice(sku);
  if (!result) return { status: 404, body: { error: "unknown sku" } };
  return { status: 200, body: serializePriceResult(result) };
};

/**
 * Fixture extraction. There is deliberately no scraper — the product is the
 * payment and credit loop, not page parsing.
 */
export const scrapeHandler: ServiceHandler = (req) => {
  const url = typeof req.query.url === "string" ? req.query.url : "";
  if (!url) return { status: 400, body: { error: "url is required" } };

  return {
    status: 200,
    body: {
      url,
      title: `Product page at ${url.replace(/^https?:\/\//, "").split("/")[0]}`,
      extracted: {
        priceMicro: jitterMicro(20_000_000n).toString(),
        inStock: Math.random() > 0.2,
        rating: Number((3.5 + Math.random() * 1.5).toFixed(1)),
      },
      fetchedAt: new Date().toISOString(),
    },
  };
};

/** Shopping shortlist across the fixture stores. */
export const shopHandler: ServiceHandler = (req) => {
  const query = typeof req.query.query === "string" ? req.query.query : "";
  if (!query) return { status: 400, body: { error: "query is required" } };

  const sku = randomSku();
  const result = lookupPrice(sku)!;

  return {
    status: 200,
    body: {
      query,
      results: STORES.slice(0, 3).map((store, i) => ({
        store,
        sku,
        priceMicro: String((result.best.priceMicro * BigInt(100 + i * 4)) / 100n),
        shipsInDays: 1 + i,
      })),
    },
  };
};

export const SERVICE_HANDLERS: Record<string, { route: string; handler: ServiceHandler }> = {
  price: { route: "/price", handler: priceHandler },
  scrape: { route: "/scrape", handler: scrapeHandler },
  shop: { route: "/shop", handler: shopHandler },
};

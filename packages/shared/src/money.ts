/**
 * Money is always bigint micro-USD. 1 USD = 1_000_000n.
 *
 * USDC on Monad has 6 decimals, so one USDC base unit is exactly one micro-USD.
 * That means no conversion happens anywhere in this system: the x402 settlement
 * amount, the onchain receipt amount, and the credit limit are all the same unit.
 * Floats appear only in formatting, at the UI edge.
 */

export const MICRO_PER_USD = 1_000_000n;

/** Parse a micro-USD amount from an env var or other string source. */
export function parseMicro(raw: string): bigint {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(`Not a valid micro-USD integer: "${raw}"`);
  }
  return BigInt(trimmed);
}

/** Format micro-USD as a plain decimal string, e.g. 1234567n -> "1.23". */
export function formatUsd(micro: bigint, decimals = 2): string {
  const negative = micro < 0n;
  const abs = negative ? -micro : micro;

  const whole = abs / MICRO_PER_USD;
  const frac = abs % MICRO_PER_USD;

  // Scale the fractional part down to the requested precision, with rounding.
  const scale = 10n ** BigInt(6 - decimals);
  let scaledFrac = (frac + scale / 2n) / scale;
  let carry = 0n;
  const fracLimit = 10n ** BigInt(decimals);
  if (scaledFrac >= fracLimit) {
    scaledFrac -= fracLimit;
    carry = 1n;
  }

  const fracStr = decimals > 0 ? "." + scaledFrac.toString().padStart(decimals, "0") : "";
  return `${negative ? "-" : ""}${whole + carry}${fracStr}`;
}

/** Format micro-USD with a leading dollar sign, e.g. "$1.23". */
export function formatUsdSymbol(micro: bigint, decimals = 2): string {
  return `$${formatUsd(micro, decimals)}`;
}

/**
 * x402 expresses price as a human string like "$0.05". Build it from micro-USD
 * so the price the middleware advertises can never drift from the price we
 * record onchain.
 */
export function microToX402Price(micro: bigint): string {
  return `$${formatUsd(micro, 6).replace(/0+$/, "").replace(/\.$/, ".0")}`;
}

export function minBig(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

export function maxBig(a: bigint, b: bigint): bigint {
  return a > b ? a : b;
}

/** Subtract without going negative — used for available = limit - outstanding. */
export function subFloor0(a: bigint, b: bigint): bigint {
  return a > b ? a - b : 0n;
}

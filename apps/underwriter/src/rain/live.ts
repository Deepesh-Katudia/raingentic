import type { AuthRequest } from "@float/shared";
import type { CardScope, IssuedCard, RainClient } from "./types.js";

/**
 * Real Rain. The request shapes below are the expected form; they get corrected
 * against the live API during the M4.5 probe. Everything upstream of this file
 * is already proven against MockRainClient, so this and parseAuthorization are
 * the only things that change when the real shape is known.
 */
export class LiveRainClient implements RainClient {
  constructor(
    private readonly apiBase: string,
    private readonly apiKey: string,
  ) {}

  private async call<T>(path: string, method: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.apiBase}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    const text = await res.text();
    if (!res.ok) {
      throw new Error(`Rain ${method} ${path} -> ${res.status}: ${text}`);
    }
    return (text ? JSON.parse(text) : {}) as T;
  }

  private encodeScope(scope: CardScope) {
    return {
      // Rain works in cents; our unit is micro-USD.
      spendLimit: Number(scope.limitMicro / 10_000n),
      allowedMerchants: scope.allowedMerchants,
      allowedMccs: scope.allowedMccs,
      expiresAt: scope.expiresAt.toISOString(),
    };
  }

  async issueCard(scope: CardScope): Promise<IssuedCard> {
    const res = await this.call<{ id: string; last4: string }>("/cards", "POST", {
      type: "virtual",
      ...this.encodeScope(scope),
    });
    console.log(`[rain:live] issued ${res.id} ****${res.last4}`);
    return { cardId: res.id, last4: res.last4 };
  }

  async updateScope(cardId: string, scope: CardScope): Promise<void> {
    await this.call(`/cards/${cardId}`, "PATCH", this.encodeScope(scope));
  }

  async getCard(cardId: string) {
    const res = await this.call<{ id: string; last4: string; spendLimit: number }>(
      `/cards/${cardId}`,
      "GET",
    );
    return {
      cardId: res.id,
      last4: res.last4,
      limitMicro: BigInt(res.spendLimit) * 10_000n,
    };
  }
}

/**
 * Normalizes Rain's authorization webhook into our AuthRequest. Kept separate
 * and total so that when the real payload differs, exactly one function moves.
 */
export function parseAuthorization(body: unknown): AuthRequest | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;

  // Accept our own canonical shape as well as the expected Rain shape.
  const authId = b.authId ?? b.id ?? b.authorizationId;
  const amount = b.amountMicro ?? b.amount ?? b.amountCents;
  const merchantId = b.merchantId ?? b.merchant ?? "unknown";
  const mcc = b.mcc ?? b.merchantCategoryCode ?? "0000";

  if (authId === undefined || amount === undefined) return null;

  // amountMicro is authoritative; amountCents needs scaling to micro-USD.
  const amountMicro =
    b.amountMicro !== undefined
      ? BigInt(String(b.amountMicro))
      : b.amountCents !== undefined
        ? BigInt(String(b.amountCents)) * 10_000n
        : BigInt(String(amount));

  return {
    authId: String(authId),
    amountMicro,
    merchantId: String(merchantId),
    mcc: String(mcc),
  };
}

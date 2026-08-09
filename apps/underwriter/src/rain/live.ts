import type { AuthRequest } from "@float/shared";
import type { CardScope, IssuedCard, RainClient } from "./types.js";

/**
 * Rain issuing client.
 *
 * Endpoints, the auth header and the balances shape below were verified against
 * the live sandbox (api-dev.raincards.xyz/v1). The earlier version of this file
 * guessed `Authorization: Bearer` and `POST /cards`; the sandbox answers that
 * with 401 "headers is missing required property 'api-key'", so every call
 * would have failed. Anything still unverified is marked UNVERIFIED and throws
 * with the real response rather than failing quietly.
 */
export class LiveRainClient implements RainClient {
  constructor(
    private readonly apiBase: string,
    private readonly apiKey: string,
    private readonly userId: string,
  ) {}

  private async call<T>(path: string, method = "GET", body?: unknown): Promise<T> {
    const res = await fetch(`${this.apiBase}${path}`, {
      method,
      headers: {
        // VERIFIED: Api-Key, not Bearer. Bearer returns 401.
        "Api-Key": this.apiKey,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    const text = await res.text();
    if (!res.ok) throw new Error(`Rain ${method} ${path} -> ${res.status}: ${text}`);
    return (text ? JSON.parse(text) : {}) as T;
  }

  /**
   * Rain works in whole cents; our unit is micro-USD. Amounts below one cent
   * cannot be expressed, so they round down — a card scoped to less than a cent
   * is not a card worth issuing.
   */
  private toCents(micro: bigint): number {
    return Number(micro / 10_000n);
  }

  /** VERIFIED: creditLimit, spendingPower, balanceDue, all in cents. */
  async balances(): Promise<{ creditLimitMicro: bigint; spendingPowerMicro: bigint; balanceDueMicro: bigint }> {
    const r = await this.call<{ creditLimit: number; spendingPower: number; balanceDue: number }>(
      `/issuing/users/${this.userId}/balances`,
    );
    return {
      creditLimitMicro: BigInt(r.creditLimit) * 10_000n,
      spendingPowerMicro: BigInt(r.spendingPower) * 10_000n,
      balanceDueMicro: BigInt(r.balanceDue) * 10_000n,
    };
  }

  /** VERIFIED: returns [] when no collateral contract has been deployed. */
  async contracts(): Promise<unknown[]> {
    return this.call<unknown[]>(`/issuing/users/${this.userId}/contracts`);
  }

  /**
   * VERIFIED endpoint and request shape.
   *
   * UNVERIFIED: the unit of `limit.amount`. Balances are documented in cents, so
   * cents is assumed here, and the outgoing value is logged on every call — a
   * 100x mismatch will be obvious in the first card rather than at spend time.
   *
   * `scope.perMerchantCaps` is NOT sent. Rain advertises merchant-locked cards
   * but the field name is not in any documentation available to us, and
   * inventing one silently drops the restriction. Per-merchant enforcement
   * therefore stays in our own authorization webhook until that field is known.
   */
  async issueCard(scope: CardScope): Promise<IssuedCard> {
    const amount = this.toCents(scope.limitMicro);
    console.log(`[rain:live] issuing virtual card limit=${amount} (cents, assumed)`);

    const res = await this.call<{ id: string; last4: string }>(
      `/issuing/users/${this.userId}/cards`,
      "POST",
      {
        type: "virtual",
        limit: { frequency: "allTime", amount },
        displayName: "FLOAT agent treasury",
        status: "active",
      },
    );

    console.log(`[rain:live] issued ${res.id} ****${res.last4}`);
    return { cardId: res.id, last4: res.last4 };
  }

  /** UNVERIFIED endpoint. Throws with Rain's actual response if the path is wrong. */
  async updateScope(cardId: string, scope: CardScope): Promise<void> {
    await this.call(`/issuing/cards/${cardId}`, "PATCH", {
      limit: { frequency: "allTime", amount: this.toCents(scope.limitMicro) },
    });
  }

  /**
   * Reads through the verified list endpoint rather than guessing at a
   * by-id route.
   */
  async getCard(cardId: string) {
    const cards = await this.call<
      { id: string; last4: string; limit?: { amount?: number } }[]
    >(`/issuing/cards?userId=${this.userId}&limit=100`);

    const card = cards.find((c) => c.id === cardId);
    if (!card) throw new Error(`Rain has no card ${cardId} for user ${this.userId}`);

    return {
      cardId: card.id,
      last4: card.last4,
      limitMicro: BigInt(card.limit?.amount ?? 0) * 10_000n,
    };
  }
}

/**
 * Normalizes Rain's authorization webhook into our AuthRequest.
 *
 * UNVERIFIED: Rain's authorization webhook payload is not in any documentation
 * available to us, their Swagger requires auth, and their docs assistant
 * reports no approve/decline webhook spec. The shapes accepted below are
 * defensive guesses. This function and the signature check are the only things
 * that change once the real spec arrives.
 */
export function parseAuthorization(body: unknown): AuthRequest | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;

  const authId = b.authId ?? b.id ?? b.authorizationId;
  const merchantId = b.merchantId ?? b.merchant ?? "unknown";
  const mcc = b.mcc ?? b.merchantCategoryCode ?? "0000";

  // amountMicro is ours and authoritative; Rain works in cents.
  let amountMicro: bigint;
  if (b.amountMicro !== undefined) {
    amountMicro = BigInt(String(b.amountMicro));
  } else if (b.amountCents !== undefined) {
    amountMicro = BigInt(String(b.amountCents)) * 10_000n;
  } else if (b.amount !== undefined) {
    amountMicro = BigInt(String(b.amount)) * 10_000n;
  } else {
    return null;
  }

  if (authId === undefined) return null;

  return {
    authId: String(authId),
    amountMicro,
    merchantId: String(merchantId),
    mcc: String(mcc),
  };
}

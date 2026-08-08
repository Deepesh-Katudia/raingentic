import type { AuthRequest, AuthDecision } from "@float/shared";
import { formatUsdSymbol } from "@float/shared";
import type { CardScope, IssuedCard, RainClient } from "./types.js";

/** Synthetic purchases land between $2 and $15 — small enough to approve while
 *  earning, large enough to decline once the limit has decayed. */
const MIN_PURCHASE_MICRO = 2_000_000n;
const MAX_PURCHASE_MICRO = 15_000_000n;

const MERCHANT = "mrc_demo_supplies";
const MCC = "5734";

/**
 * In-memory Rain. This is not scaffolding to be thrown away — it is the demo
 * fallback, and it stays working all day. If Rain is down or rate-limits during
 * the demo, flipping RAIN_MODE back to mock keeps the full loop intact.
 */
export class MockRainClient implements RainClient {
  private cards = new Map<string, { last4: string; scope: CardScope }>();
  private counter = 0;
  private timer: NodeJS.Timeout | null = null;

  async issueCard(scope: CardScope): Promise<IssuedCard> {
    this.counter++;
    const cardId = `mock_card_${this.counter}`;
    const last4 = String(4000 + this.counter).slice(-4);
    this.cards.set(cardId, { last4, scope });
    console.log(`[rain:mock] issueCard limit=${formatUsdSymbol(scope.limitMicro)} -> ${cardId} ****${last4}`);
    return { cardId, last4 };
  }

  async updateScope(cardId: string, scope: CardScope): Promise<void> {
    const card = this.cards.get(cardId);
    if (!card) throw new Error(`Unknown card ${cardId}`);
    this.cards.set(cardId, { ...card, scope });
    console.log(`[rain:mock] updateScope ${cardId} limit=${formatUsdSymbol(scope.limitMicro)}`);
  }

  async getCard(cardId: string) {
    const card = this.cards.get(cardId);
    if (!card) throw new Error(`Unknown card ${cardId}`);
    return { cardId, last4: card.last4, limitMicro: card.scope.limitMicro };
  }

  /**
   * Drives synthetic authorizations through the real decision path, so the
   * approve/decline loop is exercised end to end with zero credentials.
   */
  startSyntheticAuths(
    intervalMs: number,
    decide: (req: AuthRequest) => Promise<AuthDecision>,
  ): void {
    if (intervalMs <= 0 || this.timer) return;
    this.timer = setInterval(() => {
      const span = MAX_PURCHASE_MICRO - MIN_PURCHASE_MICRO;
      const amountMicro =
        MIN_PURCHASE_MICRO + (BigInt(Math.floor(Math.random() * 1_000_000)) * span) / 1_000_000n;

      void decide({
        authId: `mock_auth_${Date.now()}`,
        amountMicro,
        merchantId: MERCHANT,
        mcc: MCC,
      });
    }, intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

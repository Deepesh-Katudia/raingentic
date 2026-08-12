export interface CardScope {
  limitMicro: bigint;
  allowedMerchants: string[];
  allowedMccs: string[];
  /** Per-merchant ceiling in micro-USD, keyed by merchant id. */
  perMerchantCaps: Record<string, bigint>;
  expiresAt: Date;
}

export interface IssuedCard {
  cardId: string;
  last4: string;
}

/**
 * The seam between us and Rain. Everything upstream of this interface is
 * credential-free and testable; when the real API shape lands, only
 * LiveRainClient and the webhook parser change.
 */
export interface RainClient {
  issueCard(scope: CardScope): Promise<IssuedCard>;
  updateScope(cardId: string, scope: CardScope): Promise<void>;
  getCard(cardId: string): Promise<{ cardId: string; last4: string; limitMicro: bigint }>;
}

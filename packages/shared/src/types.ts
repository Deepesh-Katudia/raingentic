/** A single onchain earnings receipt. */
export interface Receipt {
  payer: `0x${string}`;
  amountMicro: bigint;
  timestamp: number;
}

/** Aggregate earnings view read from CreditFile.getProfile. */
export interface Profile {
  earnedInWindowMicro: bigint;
  distinctPayers: number;
  totalEarnedMicro: bigint;
  /** When the underwriter last refreshed this, ms since epoch. */
  readAt: number;
}

/** Output of the limit engine. */
export interface LimitState {
  projectedMicro: bigint;
  limitMicro: bigint;
  outstandingMicro: bigint;
  availableMicro: bigint;
}

/** Inbound card authorization, normalized from whatever Rain sends. */
export interface AuthRequest {
  authId: string;
  amountMicro: bigint;
  merchantId: string;
  mcc: string;
}

export interface AuthDecision {
  approved: boolean;
  reason: string;
  elapsedMs: number;
}

export interface CardSummary {
  cardId: string;
  last4: string;
  limitMicro: bigint;
}

/** Events pushed to the dashboard over SSE. */
export type StreamEvent =
  | { type: "receipt"; payer: string; amountMicro: string; timestamp: number }
  | { type: "limit"; limitMicro: string; availableMicro: string; totalEarnedMicro: string; outstandingMicro: string; distinctPayers: number }
  | { type: "auth"; authId: string; amountMicro: string; merchantId: string; approved: boolean; reason: string; elapsedMs: number }
  | { type: "card"; cardId: string; last4: string; limitMicro: string }
  | { type: "log"; level: "info" | "warn" | "error"; message: string };

/** Full snapshot served by GET /api/state. */
export interface StateSnapshot {
  profile: {
    earnedInWindowMicro: string;
    distinctPayers: number;
    totalEarnedMicro: string;
    readAt: number;
  };
  limit: {
    projectedMicro: string;
    limitMicro: string;
    outstandingMicro: string;
    availableMicro: string;
  };
  card: { cardId: string; last4: string; limitMicro: string } | null;
  incomeRunning: boolean;
  events: StreamEvent[];
}

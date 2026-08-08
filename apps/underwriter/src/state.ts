import type { Response } from "express";
import type { CardSummary, LimitState, PooledProfile, StateSnapshot, StreamEvent } from "@float/shared";
import { computeLimit, type LimitParams } from "./limit.js";

const MAX_EVENTS = 12;

/**
 * The single source of truth for the whole system. Everything mutable lives
 * here, in one process, with one writer. There is no database by design: the
 * chain is the durable record and this is the live view of it.
 *
 * The auth path reads from this object and nothing else — no RPC, no Rain call.
 * That is what makes a decision inside the ~2 second authorization window
 * possible at all.
 */
export class Store {
  private profile: PooledProfile = {
    earnedInWindowMicro: 0n,
    totalEarnedMicro: 0n,
    distinctPayers: 0,
    perAgent: [],
    readAt: 0,
  };
  private limit: LimitState = {
    projectedMicro: 0n,
    limitMicro: 0n,
    outstandingMicro: 0n,
    availableMicro: 0n,
  };
  private card: CardSummary | null = null;
  private events: StreamEvent[] = [];
  private clients = new Set<Response>();
  private incomeRunning = false;

  constructor(private readonly params: LimitParams) {}

  // --- reads (hot path) -----------------------------------------------------

  get limitState(): LimitState {
    return this.limit;
  }

  get availableMicro(): bigint {
    return this.limit.availableMicro;
  }

  get currentCard(): CardSummary | null {
    return this.card;
  }

  // --- writes ---------------------------------------------------------------

  /** Called by the chain watcher on every poll that produced a change. */
  setProfile(profile: PooledProfile): void {
    this.profile = profile;
    this.recompute();
  }

  /** Called on approval, before the response is sent. */
  addOutstanding(amountMicro: bigint): void {
    this.limit = {
      ...this.limit,
      outstandingMicro: this.limit.outstandingMicro + amountMicro,
    };
    this.recompute();
  }

  setCard(card: CardSummary): void {
    this.card = card;
    this.emit({
      type: "card",
      cardId: card.cardId,
      last4: card.last4,
      limitMicro: card.limitMicro.toString(),
    });
  }

  setIncomeRunning(running: boolean): void {
    this.incomeRunning = running;
  }

  reset(): void {
    this.limit = { ...this.limit, outstandingMicro: 0n };
    this.events = [];
    this.recompute();
  }

  private recompute(): void {
    const next = computeLimit(this.profile, this.limit.outstandingMicro, this.params);
    const changed =
      next.limitMicro !== this.limit.limitMicro ||
      next.availableMicro !== this.limit.availableMicro;

    this.limit = next;
    if (!changed) return;

    this.emit({
      type: "limit",
      limitMicro: next.limitMicro.toString(),
      availableMicro: next.availableMicro.toString(),
      totalEarnedMicro: this.profile.totalEarnedMicro.toString(),
      outstandingMicro: next.outstandingMicro.toString(),
      distinctPayers: this.profile.distinctPayers,
    });
  }

  // --- SSE ------------------------------------------------------------------

  addClient(res: Response): void {
    this.clients.add(res);
    res.write(`data: ${JSON.stringify({ type: "snapshot", snapshot: this.snapshot() })}\n\n`);
  }

  removeClient(res: Response): void {
    this.clients.delete(res);
  }

  emit(event: StreamEvent): void {
    this.events = [event, ...this.events].slice(0, MAX_EVENTS);
    const frame = `data: ${JSON.stringify(event)}\n\n`;
    for (const client of this.clients) client.write(frame);
  }

  snapshot(): StateSnapshot {
    return {
      profile: {
        earnedInWindowMicro: this.profile.earnedInWindowMicro.toString(),
        distinctPayers: this.profile.distinctPayers,
        totalEarnedMicro: this.profile.totalEarnedMicro.toString(),
        readAt: this.profile.readAt,
      },
      limit: {
        projectedMicro: this.limit.projectedMicro.toString(),
        limitMicro: this.limit.limitMicro.toString(),
        outstandingMicro: this.limit.outstandingMicro.toString(),
        availableMicro: this.limit.availableMicro.toString(),
      },
      card: this.card
        ? {
            cardId: this.card.cardId,
            last4: this.card.last4,
            limitMicro: this.card.limitMicro.toString(),
          }
        : null,
      incomeRunning: this.incomeRunning,
      events: this.events,
    };
  }
}

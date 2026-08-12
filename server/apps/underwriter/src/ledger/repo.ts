import type { StreamEvent } from "@float/shared";
import type { Db } from "../db/index.js";

export interface LedgerRow {
  id: number;
  type: string;
  direction: "income" | "expense";
  amountMicro: string;
  event: StreamEvent;
  createdAt: number;
}

interface LedgerDbRow {
  id: number;
  type: string;
  direction: string;
  amount_micro: string;
  payload: string;
  created_at: number;
}

function toRow(row: LedgerDbRow): LedgerRow {
  return {
    id: row.id,
    type: row.type,
    direction: row.direction as "income" | "expense",
    amountMicro: row.amount_micro,
    event: JSON.parse(row.payload) as StreamEvent,
    createdAt: row.created_at,
  };
}

/**
 * A real transaction is income (a settled x402 receipt) or expense (an
 * approved Rain card charge) — a decline is not a transaction, and card
 * issuance is bookkeeping, not money moving. Everything else is filtered out
 * before it ever reaches the table.
 */
function directionFor(event: StreamEvent): "income" | "expense" | null {
  if (event.type === "receipt") return "income";
  if (event.type === "auth" && event.approved) return "expense";
  return null;
}

export class LedgerRepo {
  constructor(private readonly db: Db) {}

  /** No-ops for events that are not real income/expense transactions. */
  record(event: StreamEvent, createdAt: number): void {
    const direction = directionFor(event);
    if (!direction) return;

    const amountMicro = event.type === "receipt" || event.type === "auth" ? event.amountMicro : "0";

    this.db
      .prepare(
        `INSERT INTO ledger_events (type, direction, amount_micro, payload, created_at)
         VALUES (?,?,?,?,?)`,
      )
      .run(event.type, direction, amountMicro, JSON.stringify(event), createdAt);
  }

  /** All real transactions at or after sinceMs, oldest first — nothing is ever deleted. */
  since(sinceMs: number): LedgerRow[] {
    const rows = this.db
      .prepare(`SELECT * FROM ledger_events WHERE created_at >= ? ORDER BY created_at ASC`)
      .all(sinceMs) as unknown as LedgerDbRow[];
    return rows.map(toRow);
  }
}

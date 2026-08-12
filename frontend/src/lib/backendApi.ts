// Live data layer for the underwriter service (server/apps/underwriter) — the ONLY
// two admin-portal surfaces wired to real data: the Ledger feed and the Navbar
// wallet card. Everything else in the admin portal stays on the mocked adminApi.
//
// Money arrives from the backend as micro-USD strings (6 decimals, matching USDC)
// and stays a bigint until usd() formats it for display.

// In local dev these stay '' — Vite's proxy (vite.config.ts) forwards relative
// /api and /buyers-api paths to localhost. In production (Vercel), there is no
// dev proxy, so these must point at the deployed underwriter/buyer-agents URLs.
const UNDERWRITER_URL = import.meta.env.VITE_UNDERWRITER_URL ?? ''
const BUYERS_URL = import.meta.env.VITE_BUYERS_URL ?? ''

export type StreamEvent =
  | { type: 'receipt'; payer: string; amountMicro: string; timestamp: number }
  | {
      type: 'limit'
      limitMicro: string
      availableMicro: string
      totalEarnedMicro: string
      outstandingMicro: string
      distinctPayers: number
    }
  | {
      type: 'auth'
      authId: string
      amountMicro: string
      merchantId: string
      approved: boolean
      reason: string
      elapsedMs: number
    }
  | { type: 'card'; cardId: string; last4: string; limitMicro: string }
  | { type: 'log'; level: 'info' | 'warn' | 'error'; message: string }

export interface StateSnapshot {
  profile: { earnedInWindowMicro: string; distinctPayers: number; totalEarnedMicro: string; readAt: number }
  limit: { projectedMicro: string; limitMicro: string; outstandingMicro: string; availableMicro: string }
  card: { cardId: string; last4: string; limitMicro: string } | null
  incomeRunning: boolean
  events: StreamEvent[]
}

export function usd(micro: string | bigint, decimals = 2): string {
  const v = typeof micro === 'bigint' ? micro : BigInt(micro || '0')
  const neg = v < 0n
  const abs = neg ? -v : v
  const whole = abs / 1_000_000n
  const frac = abs % 1_000_000n
  const scale = 10n ** BigInt(6 - decimals)
  const scaled = (frac + scale / 2n) / scale
  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${neg ? '-' : ''}${grouped}.${scaled.toString().padStart(decimals, '0')}`
}

export async function fetchBackendState(): Promise<StateSnapshot> {
  const res = await fetch(`${UNDERWRITER_URL}/api/state`)
  if (!res.ok) throw new Error(`GET /api/state failed: ${res.status}`)
  return res.json() as Promise<StateSnapshot>
}

export interface LedgerRow {
  id: number
  type: string
  direction: 'income' | 'expense'
  amountMicro: string
  event: StreamEvent
  createdAt: number
}

/** Real, persisted transactions (settled receipts, approved card charges) at
 *  or after sinceMs — nothing is ever deleted server-side, this just asks for
 *  a window of it (e.g. "this week"). */
export async function fetchLedgerSince(sinceMs: number): Promise<LedgerRow[]> {
  const res = await fetch(`${UNDERWRITER_URL}/api/ledger?since=${sinceMs}`)
  if (!res.ok) throw new Error(`GET /api/ledger failed: ${res.status}`)
  return res.json() as Promise<LedgerRow[]>
}

export interface SettleResult {
  ok: boolean
  requestedMicro: string
  paidMicro: string
  calls: number
  error?: string
}

/**
 * Real settlement is a fraction of the displayed session cost — the UI keeps
 * showing the full number, but only this much real testnet USDC actually
 * moves, so a limited buyer-wallet balance lasts through many demo sessions.
 */
const REAL_SETTLEMENT_FACTOR = 0.1

/**
 * Settles a chat session's dollar total as real x402 payments from a buyer
 * wallet to the seller on Monad testnet — the seller only advertises a fixed
 * price per call, so the buyer-agents service repeats calls until the
 * cumulative amount covers the (scaled-down) session cost. Each call is a
 * real onchain settlement the underwriter's chain watcher picks up automatically.
 */
export async function settleSessionOnChain(sessionCostUsd: number): Promise<SettleResult> {
  const amountMicro = Math.round(sessionCostUsd * REAL_SETTLEMENT_FACTOR * 1_000_000).toString()
  const res = await fetch(`${BUYERS_URL}${BUYERS_URL ? '' : '/buyers-api'}/control/settle`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ amountMicro }),
  })
  return res.json() as Promise<SettleResult>
}

export interface FundWeekResult {
  ok: boolean
  transferTxHash?: string
  receiptTxHash?: string
  error?: string
}

/**
 * Moves this week's mocked Overview earnings onto the real chain as one
 * transaction: the buyer wallet sends real testnet USDC to the seller wallet,
 * then the seller logs the receipt on CreditFile. Distinct from
 * settleSessionOnChain — that settles real chat usage per-call; this bridges
 * the mocked weekly total into a single real weekly income event.
 */
export async function fundWeek(weekEarningsUsd: number): Promise<FundWeekResult> {
  const amountMicro = Math.round(weekEarningsUsd * 1_000_000).toString()
  const res = await fetch(`${UNDERWRITER_URL}/api/ledger/fund-week`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ amountMicro }),
  })
  return res.json() as Promise<FundWeekResult>
}

/**
 * Draws down the real card balance for a mock Spend Agent purchase (groceries,
 * flights, anything bought through chat) and logs it as a real expense in the
 * Ledger — same debit model as an approved card charge.
 */
export async function spendReal(amountUsd: number, description: string): Promise<void> {
  const amountMicro = Math.round(amountUsd * 1_000_000).toString()
  await fetch(`${UNDERWRITER_URL}/api/spend`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ amountMicro, description }),
  })
}

/** Opens the underwriter's SSE feed. First message is always a full snapshot. */
export function openBackendStream(
  onSnapshot: (snapshot: StateSnapshot) => void,
  onEvent: (event: StreamEvent) => void,
  onConnectionChange: (connected: boolean) => void,
): () => void {
  const es = new EventSource(`${UNDERWRITER_URL}/api/stream`)
  es.onopen = () => onConnectionChange(true)
  es.onerror = () => onConnectionChange(false)
  es.onmessage = (msg) => {
    const data = JSON.parse(msg.data) as StreamEvent | { type: 'snapshot'; snapshot: StateSnapshot }
    if (data.type === 'snapshot') {
      onSnapshot(data.snapshot)
      return
    }
    onEvent(data)
  }
  return () => es.close()
}

// Mock backend layer for the admin/treasury side: agentic income, the 70/30 split
// (70% to the Rain wallet, 30% to savings), the spending agent's bill payments, a
// mocked on-chain ledger feed, and ad-hoc purchases made on request. All in-memory —
// no real Monad contract or Rain API calls exist yet.
//
// Everything here is static once seeded — numbers only change when a real action
// happens (a Spend Agent purchase), never automatically. Weekly figures are seeded
// deterministically from each week's start date, so the same week always shows the
// same numbers no matter when you look or how many times you refresh.

import { getAgents } from './mockApi'
import { spendReal } from './backendApi'

export interface ExpenseEntry {
  id: string
  category: 'Hosting' | 'AI API' | 'Manual'
  amount: number
  timestamp: number
}

export interface WeeklySplit {
  weekStart: number
  weekLabel: string
  earnings: number
  rainWallet: number
  savings: number
}

export interface LedgerEntry {
  id: string
  timestamp: number
  line: string
}

export interface AgentIncomeEntry {
  agentId: string
  agentName: string
  amount: number
  face: string
}

export interface PurchaseOption {
  name: string
  price: number
  vendor: string
}

export interface PurchaseResult {
  options: PurchaseOption[]
  chosenIndex: number
  reasoning: string
}

export interface AdminOverview {
  totalEarnings: number
  rainWalletBalance: number
  savingsBalance: number
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function randHex(len: number) {
  const chars = '0123456789abcdef'
  let out = ''
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)]
  return out
}

// Deterministic 0..1 value from a string seed — same seed always gives the same number.
function seededRandom(seed: string): number {
  let hash = 0
  for (let i = 0; i < seed.length; i++) {
    hash = (hash << 5) - hash + seed.charCodeAt(i)
    hash |= 0
  }
  const x = Math.sin(hash) * 10000
  return x - Math.floor(x)
}

function startOfWeek(date: Date): Date {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - d.getDay())
  return d
}

function formatWeekLabel(start: Date): string {
  const end = new Date(start)
  end.setDate(end.getDate() + 6)
  const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return `${fmt(start)} – ${fmt(end)}`
}

/** Last 8 weeks counting back from referenceDate's week. Deterministic per week. */
export function getWeeklySplits(referenceDate: Date): WeeklySplit[] {
  const refWeekStart = startOfWeek(referenceDate)
  const weeks: WeeklySplit[] = []

  for (let i = 7; i >= 0; i--) {
    const weekStart = new Date(refWeekStart)
    weekStart.setDate(weekStart.getDate() - i * 7)
    const seed = weekStart.toISOString().slice(0, 10)
    // Cents-to-low-dollars range, not tens of dollars — matches the real
    // economics of a $0.05/call agent, and keeps demo funding affordable on a
    // small testnet USDC balance.
    const earnings = Number((0.2 + seededRandom(seed) * 1.8).toFixed(2))

    weeks.push({
      weekStart: weekStart.getTime(),
      weekLabel: formatWeekLabel(weekStart),
      earnings,
      rainWallet: Number((earnings * 0.7).toFixed(2)),
      savings: Number((earnings * 0.3).toFixed(2)),
    })
  }

  return weeks
}

// Stable, seeded once from "this week" — never auto-changes afterward. Only a real
// Spend Agent purchase moves totalSpent, which is the only thing that touches balances.
const totalEarnings = getWeeklySplits(new Date()).reduce((sum, w) => sum + w.earnings, 0)
let totalSpent = 0

function rainWalletBalance(): number {
  return Math.max(0, Number((totalEarnings * 0.7 - totalSpent).toFixed(2)))
}

function savingsBalance(): number {
  return Number((totalEarnings * 0.3).toFixed(2))
}

const CUTE_FACES = ['🐝', '🤖', '🦉', '🦊', '🐼', '🐨', '🐙', '🐰', '🐸', '🦁']

const expenseLog: ExpenseEntry[] = [
  { id: 'exp-1', category: 'Hosting', amount: 24.0, timestamp: Date.now() - 1000 * 60 * 60 * 26 },
  { id: 'exp-2', category: 'AI API', amount: 12.5, timestamp: Date.now() - 1000 * 60 * 60 * 20 },
  { id: 'exp-3', category: 'Manual', amount: 8.0, timestamp: Date.now() - 1000 * 60 * 60 * 14 },
  { id: 'exp-4', category: 'AI API', amount: 15.75, timestamp: Date.now() - 1000 * 60 * 60 * 6 },
  { id: 'exp-5', category: 'Hosting', amount: 24.0, timestamp: Date.now() - 1000 * 60 * 60 * 2 },
]
let expenseCounter = expenseLog.length

const ledgerFeed: LedgerEntry[] = [
  { id: 'seed-1', timestamp: Date.now() - 1000 * 60 * 60 * 26, line: '[ExpenseRequested] id=1 category=Hosting amount=$24.00 tx=0xa1c3f0e29b7d' },
  { id: 'seed-2', timestamp: Date.now() - 1000 * 60 * 60 * 26, line: '[ExpenseConfirmed] id=1 tx=0xa1c3f0e29b7d' },
  { id: 'seed-3', timestamp: Date.now() - 1000 * 60 * 60 * 20, line: '[ExpenseRequested] id=2 category=AI API amount=$12.50 tx=0x7e29bcf03a15' },
  { id: 'seed-4', timestamp: Date.now() - 1000 * 60 * 60 * 20, line: '[ExpenseConfirmed] id=2 tx=0x7e29bcf03a15' },
  { id: 'seed-5', timestamp: Date.now() - 1000 * 60 * 60 * 14, line: '[ExpenseRequested] id=3 category=Manual amount=$8.00 tx=0x44dbf9a2c710' },
  { id: 'seed-6', timestamp: Date.now() - 1000 * 60 * 60 * 14, line: '[ExpenseConfirmed] id=3 tx=0x44dbf9a2c710' },
  { id: 'seed-7', timestamp: Date.now() - 1000 * 60 * 60 * 6, line: '[ExpenseRequested] id=4 category=AI API amount=$15.75 tx=0x9b2fa8e0d631' },
  { id: 'seed-8', timestamp: Date.now() - 1000 * 60 * 60 * 6, line: '[ExpenseConfirmed] id=4 tx=0x9b2fa8e0d631' },
  { id: 'seed-9', timestamp: Date.now() - 1000 * 60 * 60 * 2, line: '[ExpenseRequested] id=5 category=Hosting amount=$24.00 tx=0x1f6c8b9e0a24' },
  { id: 'seed-10', timestamp: Date.now() - 1000 * 60 * 60 * 2, line: '[ExpenseConfirmed] id=5 tx=0x1f6c8b9e0a24' },
]
let ledgerCounter = ledgerFeed.length

function pushLedgerLine(line: string) {
  ledgerCounter += 1
  ledgerFeed.unshift({ id: `ledger-${ledgerCounter}`, timestamp: Date.now(), line })
  if (ledgerFeed.length > 300) ledgerFeed.pop()
}

export async function getAdminOverview(): Promise<AdminOverview> {
  await delay(150)
  return {
    totalEarnings: Number(totalEarnings.toFixed(2)),
    rainWalletBalance: rainWalletBalance(),
    savingsBalance: savingsBalance(),
  }
}

export async function getLedgerFeed(): Promise<LedgerEntry[]> {
  return [...ledgerFeed].slice(0, 80)
}

function monthKeyFor(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

/** Per-agent income for a given month ("YYYY-MM"), seeded deterministically
 *  from the agent id + month — stable across reloads, different per month. */
export async function getAgentIncome(monthKey: string = monthKeyFor(new Date())): Promise<AgentIncomeEntry[]> {
  const agents = await getAgents()
  return agents
    .map((agent, i) => ({
      agentId: agent.id,
      agentName: agent.name,
      amount: Number((8 + seededRandom(`${agent.id}-${monthKey}`) * 42).toFixed(2)),
      face: CUTE_FACES[i % CUTE_FACES.length],
    }))
    .sort((a, b) => b.amount - a.amount)
}

const EXPENSE_CATEGORIES: ExpenseEntry['category'][] = ['Hosting', 'AI API', 'Manual']

/** Deterministic filler entries for a month, so every month has something to
 *  show even before any real Spend Agent purchase happens in it. */
function seededExpensesForMonth(monthKey: string): ExpenseEntry[] {
  const [year, month] = monthKey.split('-').map(Number)
  const daysInMonth = new Date(year, month, 0).getDate()
  const count = 4 + Math.floor(seededRandom(`${monthKey}-count`) * 4)

  return Array.from({ length: count }, (_, i) => {
    const seed = `${monthKey}-exp-${i}`
    const day = 1 + Math.floor(seededRandom(seed) * daysInMonth)
    const category = EXPENSE_CATEGORIES[Math.floor(seededRandom(`${seed}-cat`) * EXPENSE_CATEGORIES.length)]
    return {
      id: `seed-${seed}`,
      category,
      amount: Number((6 + seededRandom(`${seed}-amt`) * 28).toFixed(2)),
      timestamp: new Date(year, month - 1, day, 10).getTime(),
    }
  })
}

/** Expenses for a given month ("YYYY-MM") — real Spend Agent purchases that
 *  landed in that month, plus deterministic filler so the month isn't empty. */
export async function getExpenseLogForMonth(monthKey: string): Promise<ExpenseEntry[]> {
  await delay(150)
  const live = expenseLog.filter((e) => monthKeyFor(new Date(e.timestamp)) === monthKey)
  return [...live, ...seededExpensesForMonth(monthKey)].sort((a, b) => b.timestamp - a.timestamp)
}

const VENDORS = ['Walmart', 'Target', 'Amazon', 'Costco', 'Kroger', 'Whole Foods', 'Instacart']
const AIRLINES = ['Delta', 'United', 'American', 'JetBlue', 'Southwest']

function itemNameFromQuery(query: string): string {
  const stripped = query.replace(/^(i want to |i'd like to |please |can you )?(buy|purchase|order|get)\s+/i, '')
  return stripped.trim() || query
}

function isFlightQuery(query: string): boolean {
  return /\bflight|\bfly\b|airfare|airline|plane ticket/i.test(query)
}

/** Best-effort "X to Y" / "from X to Y" extraction — falls back to generic
 *  labels when the query doesn't spell out a route, since this is a mock. */
function parseRoute(query: string): { origin: string; destination: string } {
  const match = query.match(/(?:from\s+)?([a-z\s]{2,25}?)\s+to\s+([a-z\s]{2,25}?)(?:\s+on\b|\s+for\b|$)/i)
  if (match) {
    return { origin: match[1].trim(), destination: match[2].trim() }
  }
  return { origin: 'your origin', destination: 'your destination' }
}

function bookingRef(): string {
  return `RG-${randHex(3).toUpperCase()}${Math.floor(1000 + Math.random() * 9000)}`
}

export async function requestPurchase(query: string): Promise<PurchaseResult> {
  await delay(900)

  const flight = isFlightQuery(query)
  const itemName = flight ? '' : itemNameFromQuery(query)
  const { origin, destination } = flight ? parseRoute(query) : { origin: '', destination: '' }

  const basePrice = flight ? 150 + Math.random() * 450 : 2.5 + Math.random() * 15
  const options: PurchaseOption[] = Array.from({ length: 3 }, () => {
    if (flight) {
      const airline = AIRLINES[Math.floor(Math.random() * AIRLINES.length)]
      const price = Math.max(49, Number((basePrice + (Math.random() - 0.5) * 80).toFixed(2)))
      const stops = Math.random() < 0.6 ? 'nonstop' : '1 stop'
      return { name: `${origin} → ${destination} · ${stops}`, price, vendor: airline }
    }
    const vendor = VENDORS[Math.floor(Math.random() * VENDORS.length)]
    const price = Math.max(1, Number((basePrice + (Math.random() - 0.5) * 4).toFixed(2)))
    return { name: itemName, price, vendor }
  })

  let chosenIndex = 0
  options.forEach((o, i) => {
    if (o.price < options[chosenIndex].price) chosenIndex = i
  })

  const chosen = options[chosenIndex]
  const category = flight ? 'Manual' : 'Manual'
  const reasoning = flight
    ? `Cheapest option found — $${chosen.price.toFixed(2)} on ${chosen.vendor}, ${chosen.name.split('·')[1]?.trim()}. Booked — confirmation #${bookingRef()}.`
    : `Lowest price found — $${chosen.price.toFixed(2)} at ${chosen.vendor}, in stock now.`

  totalSpent += chosen.price
  // Real deduction is capped to a flat $0.01 regardless of the displayed mock
  // price, so a limited real balance survives many demo purchases.
  void spendReal(0.01, flight ? `Flight: ${chosen.name}` : chosen.name)
  expenseCounter += 1
  expenseLog.unshift({
    id: `exp-${expenseCounter}`,
    category,
    amount: chosen.price,
    timestamp: Date.now(),
  })
  pushLedgerLine(
    `[ExpenseRequested] id=${expenseCounter} category=${category} item="${flight ? chosen.name : itemName}" amount=$${chosen.price.toFixed(2)} vendor=${chosen.vendor} tx=0x${randHex(12)}`,
  )
  pushLedgerLine(`[ExpenseConfirmed] id=${expenseCounter} tx=0x${randHex(12)}`)

  return { options, chosenIndex, reasoning }
}

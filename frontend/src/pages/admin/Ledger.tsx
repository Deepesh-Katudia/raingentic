import { useEffect, useMemo, useRef, useState } from 'react'
import { fetchLedgerSince, openBackendStream, usd, type LedgerRow, type StreamEvent } from '@/lib/backendApi'
import Navbar from '@/components/Navbar'
import AdminNav from '@/components/AdminNav'

interface LogLine {
  id: string
  timestamp: number
  direction: 'income' | 'expense'
  amountMicro: string
  text: string
}

function startOfWeek(date: Date): Date {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - d.getDay())
  return d
}

function formatWeekRange(start: Date): string {
  const end = new Date(start)
  end.setDate(end.getDate() + 6)
  const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return `${fmt(start)} – ${fmt(end)}`
}

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString('en-US', { hour12: false })
}

/** Only real income (a settled receipt) or real expense (an approved card
 *  charge) belong in the ledger — a decline never happened and a card
 *  issuance isn't a payment. */
function directionFor(event: StreamEvent): 'income' | 'expense' | null {
  if (event.type === 'receipt') return 'income'
  if (event.type === 'auth' && event.approved) return 'expense'
  return null
}

function amountFor(event: StreamEvent): string {
  return event.type === 'receipt' || event.type === 'auth' ? event.amountMicro : '0'
}

function textFor(direction: 'income' | 'expense', event: StreamEvent): string {
  return `[${direction === 'income' ? 'INCOME' : 'EXPENSE'}] ${JSON.stringify(event)}`
}

function lineFromRow(row: LedgerRow): LogLine {
  return {
    id: `row-${row.id}`,
    timestamp: row.createdAt,
    direction: row.direction,
    amountMicro: row.amountMicro,
    text: textFor(row.direction, row.event),
  }
}

function lineFromEvent(event: StreamEvent, id: string): LogLine | null {
  const direction = directionFor(event)
  if (!direction) return null
  return {
    id,
    timestamp: Date.now(),
    direction,
    amountMicro: amountFor(event),
    text: textFor(direction, event),
  }
}

export default function Ledger() {
  const weekStart = useMemo(() => startOfWeek(new Date()), [])
  const [lines, setLines] = useState<LogLine[]>([])
  const bottomRef = useRef<HTMLDivElement>(null)
  const counterRef = useRef(0)

  useEffect(() => {
    let active = true

    fetchLedgerSince(weekStart.getTime())
      .then((rows) => {
        if (active) setLines(rows.map(lineFromRow))
      })
      .catch(() => {
        /* the live stream below still populates new transactions as they happen */
      })

    const closeStream = openBackendStream(
      () => {},
      (event) => {
        if (!active) return
        counterRef.current += 1
        const line = lineFromEvent(event, `live-${counterRef.current}`)
        if (line) setLines((prev) => [...prev, line])
      },
      () => {},
    )

    return () => {
      active = false
      closeStream()
    }
  }, [weekStart])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [lines])

  const incomeMicro = lines
    .filter((l) => l.direction === 'income')
    .reduce((sum, l) => sum + BigInt(l.amountMicro), 0n)
  const expenseMicro = lines
    .filter((l) => l.direction === 'expense')
    .reduce((sum, l) => sum + BigInt(l.amountMicro), 0n)

  return (
    <div className="flex min-h-svh flex-col bg-neutral-950 text-neutral-100">
      <Navbar />
      <AdminNav />

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-6 py-10">
        <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-3xl font-semibold tracking-tight text-white">Monad ledger feed</h1>
          <span className="text-sm text-neutral-500">Week of {formatWeekRange(weekStart)}</span>
        </div>
        <p className="mb-6 text-sm text-neutral-500">
          Real income and expense — x402 receipts settled onchain and approved Rain card charges — from the
          underwriter service on Monad testnet. Older weeks aren't deleted, just not shown here.
        </p>

        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard label="Transactions this week" value={String(lines.length)} />
          <StatCard label="Income this week" value={`$${usd(incomeMicro)}`} tone="text-emerald-400" />
          <StatCard label="Expense this week" value={`$${usd(expenseMicro)}`} tone="text-sky-400" />
        </div>

        <div className="flex-1 overflow-hidden rounded-2xl border border-emerald-900/60 bg-black">
          <div className="flex items-center gap-2 border-b border-emerald-900/60 bg-black px-4 py-2">
            <span className="h-2.5 w-2.5 rounded-full bg-red-500/70" />
            <span className="h-2.5 w-2.5 rounded-full bg-amber-500/70" />
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-500/70" />
            <span className="ml-2 font-mono text-xs text-emerald-500/70">monad-testnet — underwriter.log</span>
          </div>
          <div className="max-h-[520px] overflow-y-auto px-4 py-3 font-mono text-[13px] leading-relaxed">
            {lines.length === 0 ? (
              <p className="text-emerald-500/50">no real transactions logged this week yet…</p>
            ) : (
              lines.map((line) => (
                <p
                  key={line.id}
                  className={`whitespace-pre-wrap ${line.direction === 'income' ? 'text-emerald-400' : 'text-sky-400'}`}
                >
                  <span className="text-emerald-700">[{formatTime(line.timestamp)}]</span> {line.text}
                </p>
              ))
            )}
            <div ref={bottomRef} />
          </div>
        </div>
      </main>

      <footer className="border-t border-neutral-800 px-6 py-6 text-center text-xs text-neutral-500">
        &copy; 2026 Copyrights reserved by PayHive
      </footer>
    </div>
  )
}

function StatCard({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
      <p className="text-xs text-neutral-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${tone ?? 'text-white'}`}>{value}</p>
    </div>
  )
}

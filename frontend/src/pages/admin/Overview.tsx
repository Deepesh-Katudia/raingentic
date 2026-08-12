import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { TrendingUp, Wallet, PiggyBank } from 'lucide-react'
import {
  getAdminOverview,
  getAgentIncome,
  getExpenseLogForMonth,
  getWeeklySplits,
  type AdminOverview,
  type AgentIncomeEntry,
  type ExpenseEntry,
} from '@/lib/adminApi'
import { fundWeek, type FundWeekResult } from '@/lib/backendApi'
import Navbar from '@/components/Navbar'
import AdminNav from '@/components/AdminNav'

type FundState = { state: 'idle' } | { state: 'pending' } | { state: 'done'; result: FundWeekResult }

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

function currentMonthIso() {
  return new Date().toISOString().slice(0, 7)
}

export default function Overview() {
  const [data, setData] = useState<AdminOverview | null>(null)
  const [agentIncome, setAgentIncome] = useState<AgentIncomeEntry[]>([])
  const [expenses, setExpenses] = useState<ExpenseEntry[]>([])
  const [selectedDate, setSelectedDate] = useState(todayIso)
  const [incomeMonth, setIncomeMonth] = useState(currentMonthIso)
  const [expenseMonth, setExpenseMonth] = useState(currentMonthIso)
  const [fundState, setFundState] = useState<FundState>({ state: 'idle' })

  useEffect(() => {
    getAdminOverview().then(setData)
  }, [])

  useEffect(() => {
    getAgentIncome(incomeMonth).then(setAgentIncome)
  }, [incomeMonth])

  useEffect(() => {
    getExpenseLogForMonth(expenseMonth).then(setExpenses)
  }, [expenseMonth])

  const weeklySplits = useMemo(() => getWeeklySplits(new Date(selectedDate)), [selectedDate])
  const maxIncome = Math.max(1, ...agentIncome.map((a) => a.amount))

  const thisWeek = useMemo(() => {
    const weeks = getWeeklySplits(new Date())
    return weeks[weeks.length - 1]
  }, [])
  const [fundAmount, setFundAmount] = useState(() => thisWeek.earnings.toFixed(2))

  async function handleFundWeek() {
    const amount = Number(fundAmount)
    if (!Number.isFinite(amount) || amount <= 0) return
    setFundState({ state: 'pending' })
    const result = await fundWeek(amount)
    setFundState({ state: 'done', result })
  }

  return (
    <div className="flex min-h-svh flex-col bg-neutral-950 text-neutral-100">
      <Navbar />
      <AdminNav />

      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">
        <h1 className="mb-8 text-3xl font-semibold tracking-tight text-white">Overview</h1>

        <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
          <StatCard
            icon={<TrendingUp className="h-5 w-5 text-pink-400" />}
            label="Total earned to date"
            value={data ? `$${data.totalEarnings.toFixed(2)}` : '—'}
          />
          <StatCard
            icon={<Wallet className="h-5 w-5 text-pink-400" />}
            label="Rain wallet balance"
            value={data ? `$${data.rainWalletBalance.toFixed(2)}` : '—'}
            sub="70% of earnings, spendable"
          />
          <StatCard
            icon={<PiggyBank className="h-5 w-5 text-pink-400" />}
            label="Savings"
            value={data ? `$${data.savingsBalance.toFixed(2)}` : '—'}
            sub="30% of earnings, retained"
          />
        </div>

        <div className="mt-8 rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-sm font-medium text-neutral-400">Fund seller wallet from this week</h2>
              <p className="mt-1 text-xs text-neutral-500">
                Mock earnings this week: ${thisWeek.earnings.toFixed(2)}. Sends real testnet USDC from the buyer
                wallet to the seller wallet on Monad, then logs it as a real receipt — edit the amount below to
                whatever the buyer wallet actually holds.
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <div className="flex items-center rounded-lg border border-neutral-700 bg-neutral-950 px-2.5 py-2">
                <span className="text-sm text-neutral-500">$</span>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={fundAmount}
                  onChange={(e) => setFundAmount(e.target.value)}
                  className="ml-1 w-20 bg-transparent text-sm text-white outline-none"
                />
              </div>
              <button
                type="button"
                onClick={handleFundWeek}
                disabled={fundState.state === 'pending'}
                className="rounded-lg bg-pink-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-pink-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {fundState.state === 'pending' ? 'Funding…' : 'Fund this week'}
              </button>
            </div>
          </div>
          {fundState.state === 'done' && (
            <div className="mt-3 text-xs">
              {fundState.result.ok ? (
                <p className="text-emerald-400">
                  Funded. transfer {fundState.result.transferTxHash?.slice(0, 10)}… · receipt{' '}
                  {fundState.result.receiptTxHash?.slice(0, 10)}…
                </p>
              ) : (
                <p className="text-red-400">Failed: {fundState.result.error}</p>
              )}
            </div>
          )}
        </div>

        <div className="mt-10">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-medium text-neutral-400">Weekly breakdown — last 8 weeks</h2>
            <label className="flex items-center gap-2 text-xs text-neutral-500">
              From
              <input
                type="date"
                value={selectedDate}
                max={todayIso()}
                onChange={(e) => setSelectedDate(e.target.value || todayIso())}
                className="rounded-lg border border-neutral-800 bg-neutral-900 px-2.5 py-1.5 text-xs text-white outline-none transition focus:border-pink-500/60"
              />
            </label>
          </div>
          <div className="overflow-x-auto rounded-2xl border border-neutral-800">
            <table className="w-full text-left text-sm">
              <thead className="bg-neutral-900 text-xs uppercase tracking-wide text-neutral-500">
                <tr>
                  <th className="px-4 py-3">Week</th>
                  <th className="px-4 py-3">Earnings</th>
                  <th className="px-4 py-3">Rain wallet (70%)</th>
                  <th className="px-4 py-3">Savings (30%)</th>
                </tr>
              </thead>
              <tbody>
                {weeklySplits.map((w) => (
                  <tr key={w.weekStart} className="border-t border-neutral-800">
                    <td className="px-4 py-3 text-neutral-300">{w.weekLabel}</td>
                    <td className="px-4 py-3 tabular-nums text-white">${w.earnings.toFixed(2)}</td>
                    <td className="px-4 py-3 tabular-nums text-pink-300">${w.rainWallet.toFixed(2)}</td>
                    <td className="px-4 py-3 tabular-nums text-amber-300">${w.savings.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-10 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-sm font-medium text-neutral-400">Agent income</h2>
              <input
                type="month"
                value={incomeMonth}
                max={currentMonthIso()}
                onChange={(e) => setIncomeMonth(e.target.value || currentMonthIso())}
                className="rounded-lg border border-neutral-800 bg-neutral-950 px-2.5 py-1.5 text-xs text-white outline-none transition focus:border-pink-500/60"
              />
            </div>
            <div className="max-h-[420px] space-y-2 overflow-y-auto">
              {agentIncome.map((entry) => (
                <div key={entry.agentId} className="flex items-center gap-3 rounded-xl border border-neutral-800 bg-neutral-950 p-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-pink-500/10 text-base">
                    {entry.face}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-neutral-200">{entry.agentName}</p>
                    <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-neutral-800">
                      <div
                        className="h-full rounded-full bg-pink-500"
                        style={{ width: `${(entry.amount / maxIncome) * 100}%` }}
                      />
                    </div>
                  </div>
                  <p className="shrink-0 text-sm font-semibold tabular-nums text-pink-300">
                    ${entry.amount.toFixed(2)}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-sm font-medium text-neutral-400">Spending agent expenses</h2>
              <input
                type="month"
                value={expenseMonth}
                max={currentMonthIso()}
                onChange={(e) => setExpenseMonth(e.target.value || currentMonthIso())}
                className="rounded-lg border border-neutral-800 bg-neutral-950 px-2.5 py-1.5 text-xs text-white outline-none transition focus:border-pink-500/60"
              />
            </div>
            <div className="max-h-[420px] overflow-y-auto rounded-xl border border-neutral-800">
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 bg-neutral-950 text-xs uppercase tracking-wide text-neutral-500">
                  <tr>
                    <th className="px-4 py-3">Category</th>
                    <th className="px-4 py-3">Amount</th>
                    <th className="px-4 py-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {expenses.map((entry) => (
                    <tr key={entry.id} className="border-t border-neutral-800 transition hover:bg-neutral-950/60">
                      <td className="px-4 py-3 text-neutral-300">{entry.category}</td>
                      <td className="px-4 py-3 tabular-nums text-neutral-300">${entry.amount.toFixed(2)}</td>
                      <td className="px-4 py-3">
                        <span className="rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-300">
                          Paid
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </main>

      <footer className="border-t border-neutral-800 px-6 py-6 text-center text-xs text-neutral-500">
        &copy; 2026 Copyrights reserved by PayHive
      </footer>
    </div>
  )
}

function StatCard({ icon, label, value, sub }: { icon: ReactNode; label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-6 transition hover:border-pink-500/40">
      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-pink-500/10">{icon}</div>
      <p className="text-xs text-neutral-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-white">{value}</p>
      {sub && <p className="mt-1 text-xs text-neutral-600">{sub}</p>}
    </div>
  )
}

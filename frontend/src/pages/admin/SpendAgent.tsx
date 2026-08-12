import { useEffect, useRef, useState } from 'react'
import { CheckCircle2, ShoppingCart, Sparkles } from 'lucide-react'
import { requestPurchase, type PurchaseResult } from '@/lib/adminApi'
import { cn } from '@/lib/utils'
import Navbar from '@/components/Navbar'
import AdminNav from '@/components/AdminNav'

interface Message {
  id: string
  role: 'user' | 'agent'
  content?: string
  purchase?: PurchaseResult
}

const SUGGESTIONS = ['buy Quaker Oats', 'buy printer paper', 'book a flight from NYC to LAX']

function AgentAvatar() {
  return (
    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-pink-600">
      <Sparkles className="h-4 w-4 text-white" />
    </div>
  )
}

export default function SpendAgent() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      role: 'agent',
      content:
        "Hi, I'm the Spending Agent. Tell me what you want to buy and I'll find the best price and pay for it with the Rain card.",
    },
  ])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, sending])

  useEffect(() => {
    if (!sending) inputRef.current?.focus()
  }, [sending])

  async function sendText(text: string) {
    if (!text || sending) return

    setMessages((prev) => [...prev, { id: `${Date.now()}-user`, role: 'user', content: text }])
    setInput('')
    setSending(true)

    const purchase = await requestPurchase(text)

    setMessages((prev) => [...prev, { id: `${Date.now()}-agent`, role: 'agent', purchase }])
    setSending(false)
  }

  return (
    <div className="flex min-h-svh flex-col bg-neutral-950 text-neutral-100">
      <Navbar />
      <AdminNav />

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-3 overflow-y-auto px-6 py-6">
        {messages.map((m) => (
          <div
            key={m.id}
            className={cn('message-in flex items-end gap-2', m.role === 'user' ? 'justify-end' : 'justify-start')}
          >
            {m.role === 'agent' && <AgentAvatar />}

            {m.purchase ? (
              <div className="max-w-[85%] rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
                <p className="mb-3 text-xs font-medium uppercase tracking-wide text-neutral-500">
                  Comparing options…
                </p>
                <div className="flex flex-col gap-2">
                  {m.purchase.options.map((option, i) => (
                    <div
                      key={`${option.vendor}-${i}`}
                      className={cn(
                        'flex items-center gap-3 rounded-xl border p-3',
                        i === m.purchase!.chosenIndex
                          ? 'border-pink-500/60 bg-pink-500/10'
                          : 'border-neutral-800 bg-neutral-950',
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-white">{option.name}</p>
                        <p className="text-xs text-neutral-500">{option.vendor}</p>
                      </div>
                      <p className="shrink-0 text-sm font-semibold tabular-nums text-pink-300">
                        ${option.price.toFixed(2)}
                      </p>
                      {i === m.purchase!.chosenIndex && <CheckCircle2 className="h-4 w-4 shrink-0 text-pink-400" />}
                    </div>
                  ))}
                </div>

                <p className="mt-3 text-sm text-neutral-400">
                  <span className="font-medium text-neutral-300">Why: </span>
                  {m.purchase.reasoning}
                </p>

                <div className="mt-4 flex items-center gap-3 rounded-xl border border-emerald-800/60 bg-emerald-500/10 p-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/15">
                    <ShoppingCart className="h-4.5 w-4.5 text-emerald-400" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-white">
                      Bought: {m.purchase.options[m.purchase.chosenIndex].name}
                    </p>
                    <p className="text-xs text-neutral-500">
                      Paid via Rain card — {m.purchase.options[m.purchase.chosenIndex].vendor}
                    </p>
                  </div>
                  <p className="shrink-0 text-sm font-semibold tabular-nums text-emerald-300">
                    ${m.purchase.options[m.purchase.chosenIndex].price.toFixed(2)}
                  </p>
                </div>
              </div>
            ) : (
              <div
                className={cn(
                  'max-w-[75%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed',
                  m.role === 'user'
                    ? 'bg-pink-600 text-white'
                    : 'border border-neutral-800 bg-neutral-900 text-neutral-200',
                )}
              >
                {m.content}
              </div>
            )}
          </div>
        ))}

        {sending && (
          <div className="message-in flex items-end justify-start gap-2">
            <AgentAvatar />
            <div className="flex items-center gap-1.5 rounded-2xl border border-neutral-800 bg-neutral-900 px-4 py-3.5">
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-neutral-500 [animation-delay:-0.3s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-neutral-500 [animation-delay:-0.15s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-neutral-500" />
            </div>
          </div>
        )}

        {messages.length === 1 && !sending && (
          <div className="message-in flex flex-wrap items-center gap-2 pl-10 pt-2">
            <span className="text-xs text-neutral-500">Try:</span>
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => sendText(s)}
                className="cursor-pointer rounded-full border border-neutral-800 bg-neutral-900 px-3 py-1.5 text-xs text-neutral-400 transition hover:border-pink-500/60 hover:text-pink-300"
              >
                {s}
              </button>
            ))}
          </div>
        )}

        <div ref={bottomRef} />
      </main>

      <footer className="border-t border-neutral-800 px-6 py-4">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            sendText(input.trim())
          }}
          className="mx-auto flex max-w-3xl gap-3"
        >
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={sending}
            placeholder="I want to buy…"
            className="flex-1 rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-2.5 text-sm text-white placeholder-neutral-500 outline-none transition focus:border-pink-500/60 focus:ring-2 focus:ring-pink-500/15 disabled:opacity-40"
          />
          <button
            type="submit"
            disabled={sending || !input.trim()}
            className="cursor-pointer rounded-lg bg-pink-600 px-4 py-2.5 text-sm font-medium text-white transition hover:scale-[1.03] hover:bg-pink-500 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:scale-100"
          >
            Send
          </button>
        </form>
      </footer>
    </div>
  )
}

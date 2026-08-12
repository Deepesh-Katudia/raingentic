import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Paperclip, ShoppingBag, Sparkles, X } from 'lucide-react'
import {
  getAgents,
  sendChatMessage,
  type Agent,
  type ChatAttachment,
  type ChatTurn,
  type ProductMatch,
} from '@/lib/mockApi'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/store/authStore'
import { useUsageStore } from '@/store/usageStore'
import { settleSessionOnChain } from '@/lib/backendApi'
import Navbar from '@/components/Navbar'

type SettlementStatus =
  | { state: 'idle' }
  | { state: 'pending' }
  | { state: 'success'; paidUsd: number; calls: number }
  | { state: 'error'; message: string }

interface Message {
  id: string
  role: 'user' | 'agent'
  content: string
  product?: ProductMatch
  real?: boolean
  attachmentName?: string
}

interface StoredSession {
  messages: Message[]
  sessionCost: number
  callCount: number
  sessionId: string
}

const TEXT_FILE_PATTERN = /\.(txt|md|csv|json)$/i

function storageKey(agentId: string) {
  return `payhive-chat-${agentId}`
}

function loadStoredSession(agentId: string): StoredSession | null {
  try {
    const raw = localStorage.getItem(storageKey(agentId))
    return raw ? (JSON.parse(raw) as StoredSession) : null
  } catch {
    return null
  }
}

function newSessionId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error)
    reader.readAsText(file)
  })
}

function AgentAvatar() {
  return (
    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-pink-600">
      <Sparkles className="h-4 w-4 text-white" />
    </div>
  )
}

export default function Chat() {
  const { agentId } = useParams()
  const navigate = useNavigate()
  const loggedIn = useAuthStore((s) => s.loggedIn)
  const card = useAuthStore((s) => s.card)
  const openModal = useAuthStore((s) => s.openModal)
  const upsertUsage = useUsageStore((s) => s.upsertEntry)

  const [agent, setAgent] = useState<Agent | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [sessionCost, setSessionCost] = useState(0)
  const [callCount, setCallCount] = useState(0)
  const [ended, setEnded] = useState(false)
  const [attachedFile, setAttachedFile] = useState<File | null>(null)
  const [settlement, setSettlement] = useState<SettlementStatus>({ state: 'idle' })

  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const sessionCostRef = useRef(0)
  const messagesRef = useRef<Message[]>([])
  const endedRef = useRef(false)

  useEffect(() => {
    sessionCostRef.current = sessionCost
  }, [sessionCost])
  useEffect(() => {
    messagesRef.current = messages
  }, [messages])
  useEffect(() => {
    endedRef.current = ended
  }, [ended])

  useEffect(() => {
    if (!loggedIn) {
      openModal('signin', 'Sign in to start chatting with an agent.')
      navigate('/', { replace: true })
    } else if (!card) {
      openModal('wallet', 'Add a payment card to start using agents.')
      navigate('/', { replace: true })
    }
  }, [loggedIn, card, navigate, openModal])

  useEffect(() => {
    getAgents().then((agents) => {
      const found = agents.find((a) => a.id === agentId) ?? null
      setAgent(found)
      if (!found || !agentId) return

      const stored = loadStoredSession(agentId)
      if (stored && stored.messages.length > 0) {
        setMessages(stored.messages)
        setSessionCost(stored.sessionCost)
        setCallCount(stored.callCount)
        setSessionId(stored.sessionId)
      } else {
        setMessages([{ id: 'welcome', role: 'agent', content: found.greeting }])
        setSessionId(newSessionId())
      }
    })
  }, [agentId])

  useEffect(() => {
    if (agentId && messages.length > 0 && sessionId && !ended) {
      const blob: StoredSession = { messages, sessionCost, callCount, sessionId }
      localStorage.setItem(storageKey(agentId), JSON.stringify(blob))
    }
  }, [agentId, messages, sessionCost, callCount, sessionId, ended])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, sending])

  useEffect(() => {
    if (!sending && !ended) inputRef.current?.focus()
  }, [sending, ended])

  useEffect(() => {
    // Every call is already recorded durably the instant it completes (see sendText) —
    // this cleanup is just a best-effort "close out this visit" step for when the user
    // navigates away within the app (back arrow, logo click). It resets the live counter
    // for next time while keeping the conversation, but if it never runs (a typed URL,
    // closing the tab) nothing is lost: the last message's upsert already has the
    // accurate total, it just keeps accumulating into the same entry next time instead
    // of starting a clean $0 count.
    return () => {
      if (!agentId || endedRef.current || sessionCostRef.current <= 0) return
      const blob: StoredSession = {
        messages: messagesRef.current,
        sessionCost: 0,
        callCount: 0,
        sessionId: newSessionId(),
      }
      localStorage.setItem(storageKey(agentId), JSON.stringify(blob))
    }
  }, [agentId])

  async function sendText(text: string) {
    if (!text || sending || ended || !agentId || !sessionId) return

    const history: ChatTurn[] = messages.slice(-10).map((m) => ({
      role: m.role === 'user' ? 'user' : 'assistant',
      content: m.content,
    }))

    let attachment: ChatAttachment | undefined
    const file = attachedFile

    if (file) {
      if (TEXT_FILE_PATTERN.test(file.name) || file.type.startsWith('text/')) {
        try {
          attachment = { name: file.name, textContent: await readFileAsText(file) }
        } catch {
          attachment = { name: file.name }
        }
      } else {
        attachment = { name: file.name }
      }
    }

    setMessages((prev) => [
      ...prev,
      { id: `${Date.now()}-user`, role: 'user', content: text, attachmentName: file?.name },
    ])
    setInput('')
    setAttachedFile(null)
    setSending(true)

    const { reply, cost, product, real } = await sendChatMessage(agentId, text, history, attachment)

    const newCost = sessionCost + cost
    const newCalls = callCount + 1

    setMessages((prev) => [...prev, { id: `${Date.now()}-agent`, role: 'agent', content: reply, product, real }])
    setSessionCost(newCost)
    setCallCount(newCalls)
    setSending(false)

    // Recorded the instant it happens — durable regardless of how the tab is later closed.
    upsertUsage(sessionId, {
      agentId,
      agentName: agent?.name ?? agentId,
      cost: newCost,
      calls: newCalls,
      endedAt: Date.now(),
    })
  }

  function handleEndSession() {
    setEnded(true)
    if (agentId) localStorage.removeItem(storageKey(agentId))

    if (sessionCost <= 0) return

    setSettlement({ state: 'pending' })
    settleSessionOnChain(sessionCost)
      .then((result) => {
        if (result.ok) {
          setSettlement({ state: 'success', paidUsd: Number(result.paidMicro) / 1_000_000, calls: result.calls })
        } else {
          setSettlement({ state: 'error', message: result.error ?? 'settlement failed' })
        }
      })
      .catch((err) => {
        setSettlement({ state: 'error', message: err instanceof Error ? err.message : String(err) })
      })
  }

  if (!agentId) return null

  return (
    <div className="flex min-h-svh flex-col bg-neutral-950 text-neutral-100">
      <Navbar />

      <div className="flex items-center justify-between border-b border-neutral-800 px-6 py-3">
        <div className="flex items-center gap-3">
          <Link to="/" className="text-neutral-400 transition hover:text-pink-400">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <h1 className="text-sm font-medium text-white">{agent?.name ?? 'Agent'}</h1>
            {agent && <p className="text-xs text-neutral-500">${agent.pricePerCall.toFixed(2)}/call</p>}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="rounded-full bg-pink-500/10 px-3 py-1.5 text-xs font-medium tabular-nums text-pink-300">
            Session cost: ${sessionCost.toFixed(2)} · {callCount} {callCount === 1 ? 'call' : 'calls'}
          </div>
          <button
            onClick={handleEndSession}
            disabled={ended}
            className="cursor-pointer rounded-lg border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300 transition hover:border-red-500/60 hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            End session
          </button>
        </div>
      </div>

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-3 overflow-y-auto px-6 py-6">
        {messages.map((m) => (
          <div
            key={m.id}
            className={cn(
              'message-in flex flex-col gap-1',
              m.role === 'user' ? 'items-end' : 'items-start',
            )}
          >
            <div className={cn('flex items-end gap-2', m.role === 'user' ? 'flex-row-reverse' : 'flex-row')}>
              {m.role === 'agent' && <AgentAvatar />}

              {m.product ? (
                <div className="max-w-[75%] rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
                  <p className="mb-3 text-sm text-neutral-300">{m.content}</p>
                  <div className="flex items-center gap-3 rounded-xl border border-neutral-800 bg-neutral-950 p-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-pink-500/10">
                      <ShoppingBag className="h-5 w-5 text-pink-400" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-white">{m.product.name}</p>
                      <p className="text-xs text-neutral-500">{m.product.retailer}</p>
                    </div>
                    <p className="shrink-0 text-sm font-semibold tabular-nums text-pink-300">
                      ${m.product.price.toFixed(2)}
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
                  {m.attachmentName && (
                    <div className="mt-2 flex items-center gap-1.5 rounded-lg bg-black/15 px-2 py-1 text-xs opacity-90">
                      <Paperclip className="h-3 w-3" />
                      <span className="truncate">{m.attachmentName}</span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {m.role === 'agent' && typeof m.real === 'boolean' && (
              <span className={cn('pl-10 text-[11px]', m.real ? 'text-pink-400/70' : 'text-neutral-600')}>
                {m.real ? '● live via Groq' : '○ demo reply — relay offline'}
              </span>
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

        {messages.length === 1 && !sending && !ended && agent && (
          <div className="message-in flex flex-wrap items-center gap-2 pl-10 pt-2">
            <span className="text-xs text-neutral-500">Quick start:</span>
            {agent.suggestions.map((s) => (
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
        {attachedFile && (
          <div className="mx-auto mb-2 flex max-w-3xl items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-1.5 text-xs text-neutral-300">
            <Paperclip className="h-3.5 w-3.5 text-neutral-500" />
            <span className="truncate">{attachedFile.name}</span>
            <button
              type="button"
              onClick={() => setAttachedFile(null)}
              className="ml-auto cursor-pointer text-neutral-500 transition hover:text-red-400"
              aria-label="Remove attachment"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault()
            sendText(input.trim())
          }}
          className="mx-auto flex max-w-3xl gap-3"
        >
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={(e) => setAttachedFile(e.target.files?.[0] ?? null)}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={ended || sending}
            aria-label="Attach a document"
            className="cursor-pointer rounded-lg border border-neutral-800 bg-neutral-900 px-3 text-neutral-400 transition hover:border-pink-500/60 hover:text-pink-300 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Paperclip className="h-4 w-4" />
          </button>
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={ended || sending}
            placeholder="Ask for a product…"
            className="flex-1 rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-2.5 text-sm text-white placeholder-neutral-500 outline-none transition focus:border-pink-500/60 focus:ring-2 focus:ring-pink-500/15 disabled:opacity-40"
          />
          <button
            type="submit"
            disabled={ended || sending || !input.trim()}
            className="cursor-pointer rounded-lg bg-pink-600 px-4 py-2.5 text-sm font-medium text-white transition hover:scale-[1.03] hover:bg-pink-500 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:scale-100"
          >
            Send
          </button>
        </form>
      </footer>

      {ended && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm">
          <div className="modal-in w-full max-w-sm rounded-2xl border border-neutral-800 bg-neutral-900 p-6 text-center">
            <h2 className="text-lg font-semibold text-white">Session ended</h2>
            <p className="mt-2 text-sm text-neutral-400">
              {callCount} {callCount === 1 ? 'call' : 'calls'} to {agent?.name ?? 'agent'}
            </p>
            <p className="mt-4 text-3xl font-semibold tabular-nums text-pink-400">${sessionCost.toFixed(2)}</p>
            <p className="text-xs text-neutral-500">total charged</p>

            {settlement.state === 'pending' && (
              <p className="mt-4 flex items-center justify-center gap-2 text-xs text-neutral-500">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />
                Settling on Monad testnet…
              </p>
            )}
            {settlement.state === 'success' && (
              <p className="mt-4 text-xs text-emerald-400">
                Settled ${settlement.paidUsd.toFixed(2)} onchain across {settlement.calls}{' '}
                {settlement.calls === 1 ? 'payment' : 'payments'}.
              </p>
            )}
            {settlement.state === 'error' && (
              <p className="mt-4 text-xs text-red-400">Couldn't settle onchain: {settlement.message}</p>
            )}

            <button
              onClick={() => navigate('/')}
              className="mt-6 w-full cursor-pointer rounded-lg bg-pink-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-pink-500"
            >
              Back to agents
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

import { useEffect, useState } from 'react'
import { CreditCard } from 'lucide-react'
import { fetchBackendState, openBackendStream, usd, type StateSnapshot } from '@/lib/backendApi'

export default function AdminWalletCard() {
  const [card, setCard] = useState<StateSnapshot['card']>(null)
  const [availableMicro, setAvailableMicro] = useState('0')
  const [connected, setConnected] = useState(false)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let active = true

    fetchBackendState()
      .then((snapshot) => {
        if (!active) return
        setCard(snapshot.card)
        setAvailableMicro(snapshot.limit.availableMicro)
      })
      .catch(() => {
        /* stream connection below will still populate the card */
      })

    const closeStream = openBackendStream(
      (snapshot) => {
        if (!active) return
        setCard(snapshot.card)
        setAvailableMicro(snapshot.limit.availableMicro)
      },
      (event) => {
        if (!active) return
        if (event.type === 'limit') setAvailableMicro(event.availableMicro)
        if (event.type === 'card') setCard({ cardId: event.cardId, last4: event.last4, limitMicro: event.limitMicro })
      },
      (isConnected) => {
        if (active) setConnected(isConnected)
      },
    )

    return () => {
      active = false
      closeStream()
    }
  }, [])

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Rain wallet balance"
        className="flex cursor-pointer items-center gap-2 rounded-lg border border-neutral-700 px-3 py-2 text-sm text-neutral-200 transition hover:border-emerald-500 hover:text-emerald-400"
      >
        <CreditCard className="h-4 w-4" />
        <span className="tabular-nums">${usd(availableMicro)}</span>
        <span
          className={`h-1.5 w-1.5 rounded-full ${connected ? 'bg-emerald-400' : 'bg-red-500'}`}
          title={connected ? 'Live' : 'Disconnected'}
        />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-64 rounded-xl border border-neutral-800 bg-neutral-900 p-4 shadow-xl">
          <p className="text-xs text-neutral-500">Rain wallet</p>
          <p className="mt-1 font-mono text-lg text-white">
            •••• {card?.last4 ?? '————'}
          </p>
          <p className="mt-0.5 truncate text-[11px] text-neutral-600">{card?.cardId ?? 'not issued yet'}</p>

          <div className="mt-3 flex items-baseline justify-between border-t border-neutral-800 pt-3">
            <span className="text-xs text-neutral-500">Spendable now</span>
            <span className="text-sm font-semibold tabular-nums text-emerald-400">${usd(availableMicro)}</span>
          </div>
          <div className="mt-1 flex items-baseline justify-between">
            <span className="text-xs text-neutral-500">Card limit</span>
            <span className="text-sm tabular-nums text-neutral-300">${usd(card?.limitMicro ?? '0')}</span>
          </div>

          <p className="mt-3 text-[11px] text-neutral-600">
            {connected ? 'Live from the underwriter service.' : 'Reconnecting to backend…'}
          </p>
        </div>
      )}
    </div>
  )
}

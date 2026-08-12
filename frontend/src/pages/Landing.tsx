import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getAgents, type Agent } from '@/lib/mockApi'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/store/authStore'
import Navbar from '@/components/Navbar'

const PAGE_SIZE = 16

export default function Landing() {
  const navigate = useNavigate()
  const loggedIn = useAuthStore((s) => s.loggedIn)
  const card = useAuthStore((s) => s.card)
  const openModal = useAuthStore((s) => s.openModal)
  const [agents, setAgents] = useState<Agent[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)

  useEffect(() => {
    getAgents().then((data) => {
      setAgents(data)
      setLoading(false)
    })
  }, [])

  const filteredAgents = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return agents
    return agents.filter((a) => a.name.toLowerCase().includes(q) || a.description.toLowerCase().includes(q))
  }, [agents, search])

  const totalPages = Math.max(1, Math.ceil(filteredAgents.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const pageAgents = filteredAgents.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

  function handleSearchChange(value: string) {
    setSearch(value)
    setPage(1)
  }

  function handleAgentClick(agentId: string) {
    if (!loggedIn) {
      openModal('signin', 'Sign in to start chatting with an agent.')
      return
    }
    if (!card) {
      openModal('wallet', 'Add a payment card to start using agents.')
      return
    }
    navigate(`/chat/${agentId}`)
  }

  return (
    <div className="flex min-h-svh flex-col bg-neutral-950 text-neutral-100">
      <Navbar searchValue={search} onSearchChange={handleSearchChange} />

      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">
        <div className="mb-6">
          <h1 className="text-3xl font-semibold tracking-tight text-white">Service Agents</h1>
          <p className="mt-2 text-neutral-400">Pick an agent to start a session.</p>
        </div>

        {loading ? (
          <div className="text-neutral-500">Loading agents…</div>
        ) : filteredAgents.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-neutral-800 py-16 text-center text-neutral-500">
            No agents match "{search}".
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-7 sm:grid-cols-2 lg:grid-cols-4">
              {pageAgents.map((agent) => (
                <button
                  key={agent.id}
                  onClick={() => handleAgentClick(agent.id)}
                  className="group flex cursor-pointer flex-col rounded-2xl border border-neutral-800 bg-neutral-900 p-7 text-left transition duration-200 hover:-translate-y-1 hover:border-pink-500/60 hover:bg-neutral-900/80 hover:shadow-lg hover:shadow-pink-500/10"
                >
                  <span className="mb-4 inline-flex w-fit rounded-full bg-pink-500/10 px-3 py-1 text-xs font-medium text-pink-300">
                    ${agent.pricePerCall.toFixed(2)}/call
                  </span>
                  <h2 className="text-lg font-medium text-white">{agent.name}</h2>
                  <p className="mt-2 text-sm leading-relaxed text-neutral-400">{agent.description}</p>
                </button>
              ))}
            </div>

            {totalPages > 1 && (
              <div className="mt-10 flex items-center justify-center gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="cursor-pointer rounded-lg border border-neutral-800 px-3 py-1.5 text-sm text-neutral-400 transition hover:border-pink-500/60 hover:text-pink-300 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Prev
                </button>

                {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
                  <button
                    key={p}
                    onClick={() => setPage(p)}
                    className={cn(
                      'cursor-pointer rounded-lg px-3 py-1.5 text-sm tabular-nums transition',
                      p === currentPage
                        ? 'bg-pink-600 text-white'
                        : 'border border-neutral-800 text-neutral-400 hover:border-pink-500/60 hover:text-pink-300',
                    )}
                  >
                    {p}
                  </button>
                ))}

                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className="cursor-pointer rounded-lg border border-neutral-800 px-3 py-1.5 text-sm text-neutral-400 transition hover:border-pink-500/60 hover:text-pink-300 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            )}
          </>
        )}
      </main>

      <footer className="border-t border-neutral-800 px-6 py-6 text-center text-xs text-neutral-500">
        &copy; 2026 Copyrights reserved by PayHive
      </footer>
    </div>
  )
}

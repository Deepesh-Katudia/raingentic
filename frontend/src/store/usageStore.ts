import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface UsageEntry {
  id: string
  agentId: string
  agentName: string
  cost: number
  calls: number
  endedAt: number
}

interface UsageState {
  history: UsageEntry[]
  upsertEntry: (id: string, entry: Omit<UsageEntry, 'id'>) => void
}

export const useUsageStore = create<UsageState>()(
  persist(
    (set) => ({
      history: [],
      // Called after every single agent reply, not just on exit — this makes each
      // call durable the instant it completes, so there's no "pending" charge that
      // could be lost if the tab is closed, refreshed to a new URL, or crashes.
      upsertEntry: (id, entry) =>
        set((state) => {
          const full: UsageEntry = { ...entry, id }
          const existingIndex = state.history.findIndex((e) => e.id === id)
          const history =
            existingIndex >= 0
              ? state.history.map((e, i) => (i === existingIndex ? full : e))
              : [full, ...state.history].slice(0, 200)
          return { history }
        }),
    }),
    { name: 'payhive-usage' },
  ),
)

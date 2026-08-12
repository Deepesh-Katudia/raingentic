import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface AdminAuthState {
  loggedIn: boolean
  login: () => void
  logout: () => void
}

export const useAdminAuthStore = create<AdminAuthState>()(
  persist(
    (set) => ({
      loggedIn: false,
      login: () => set({ loggedIn: true }),
      logout: () => set({ loggedIn: false }),
    }),
    { name: 'payhive-admin-auth' },
  ),
)

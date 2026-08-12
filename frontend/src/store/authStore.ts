import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type AuthModalKind = 'signin' | 'signup' | 'wallet' | null

export interface CardInfo {
  name: string
  number: string
  expiry: string
}

interface AuthState {
  loggedIn: boolean
  card: CardInfo | null
  modal: AuthModalKind
  prompt: string | null
  login: () => void
  logout: () => void
  setCard: (card: CardInfo) => void
  openModal: (kind: AuthModalKind, prompt?: string) => void
  closeModal: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      loggedIn: false,
      card: null,
      modal: null,
      prompt: null,
      login: () => set({ loggedIn: true }),
      logout: () => set({ loggedIn: false, card: null }),
      setCard: (card) => set({ card }),
      openModal: (kind, prompt) => set({ modal: kind, prompt: prompt ?? null }),
      closeModal: () => set({ modal: null, prompt: null }),
    }),
    {
      name: 'payhive-auth',
      partialize: (state) => ({ loggedIn: state.loggedIn, card: state.card }),
    },
  ),
)

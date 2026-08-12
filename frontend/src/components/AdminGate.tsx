import { useState, type FormEvent, type ReactNode } from 'react'
import { useAdminAuthStore } from '@/store/adminAuthStore'
import Navbar from './Navbar'

const ADMIN_EMAIL = import.meta.env.VITE_ADMIN_EMAIL
const ADMIN_PASSWORD = import.meta.env.VITE_ADMIN_PASSWORD

export default function AdminGate({ children }: { children: ReactNode }) {
  const loggedIn = useAdminAuthStore((s) => s.loggedIn)
  const login = useAdminAuthStore((s) => s.login)
  const [error, setError] = useState('')

  if (loggedIn) return <>{children}</>

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const email = String(form.get('email') ?? '')
    const password = String(form.get('password') ?? '')

    if (email.toLowerCase() === ADMIN_EMAIL.toLowerCase() && password === ADMIN_PASSWORD) {
      login()
    } else {
      setError('Invalid admin email or password.')
    }
  }

  return (
    <div className="min-h-svh bg-neutral-950 text-neutral-100">
      <Navbar />

      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm">
        <div className="modal-in w-full max-w-sm rounded-2xl border border-neutral-800 bg-neutral-900 p-6">
          <h1 className="mb-5 text-lg font-semibold text-white">Admin login</h1>
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <input
              name="email"
              type="email"
              placeholder="Admin email"
              autoComplete="off"
              className="w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2.5 text-sm text-white placeholder-neutral-500 outline-none transition focus:border-pink-500/60 focus:ring-2 focus:ring-pink-500/15"
            />
            <input
              name="password"
              type="password"
              placeholder="Admin password"
              autoComplete="off"
              className="w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2.5 text-sm text-white placeholder-neutral-500 outline-none transition focus:border-pink-500/60 focus:ring-2 focus:ring-pink-500/15"
            />
            {error && <p className="text-xs text-red-400">{error}</p>}
            <button
              type="submit"
              className="cursor-pointer rounded-lg bg-pink-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-pink-500"
            >
              Sign in to Admin
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}

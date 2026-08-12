import { useState, type FormEvent } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Clock, CreditCard, Eye, EyeOff, Search, Sparkles, Wallet, X } from 'lucide-react'
import { useAuthStore } from '@/store/authStore'
import { useAdminAuthStore } from '@/store/adminAuthStore'
import { useUsageStore } from '@/store/usageStore'
import { formatCardNumber, formatExpiry, isCardNumberValid, isCvcValid, isExpiryValid } from '@/lib/cardValidation'
import AdminWalletCard from '@/components/AdminWalletCard'

interface NavbarProps {
  searchValue?: string
  onSearchChange?: (value: string) => void
}

const inputClass =
  'w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2.5 text-sm text-white placeholder-neutral-500 outline-none transition focus:border-pink-500/60 focus:ring-2 focus:ring-pink-500/15'

const halfInputClass = `${inputClass} min-w-0 flex-1`

const DEMO_EMAIL = import.meta.env.VITE_DEMO_EMAIL
const DEMO_PASSWORD = import.meta.env.VITE_DEMO_PASSWORD
const TEST_CARD_NAME = import.meta.env.VITE_DEMO_CARD_NAME
const TEST_CARD_NUMBER = import.meta.env.VITE_DEMO_CARD_NUMBER
const TEST_CARD_EXPIRY = import.meta.env.VITE_DEMO_CARD_EXPIRY
const TEST_CARD_CVC = import.meta.env.VITE_DEMO_CARD_CVC

const socialButtonClass =
  'flex flex-1 cursor-pointer items-center justify-center rounded-lg border border-neutral-800 bg-neutral-950 py-2.5 transition hover:border-pink-500/60'

function GitHubIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 fill-neutral-300">
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.135.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  )
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4">
      <path
        fill="#4285F4"
        d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v2.98h3.86c2.26-2.09 3.56-5.17 3.56-8.8z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-2.98c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09C3.26 21.3 7.31 24 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.27 14.31c-.23-.68-.35-1.41-.35-2.16 0-.75.12-1.48.35-2.16V6.9H1.29A11.94 11.94 0 000 12c0 1.94.46 3.77 1.29 5.4l3.98-3.09z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.6l3.98 3.09c.95-2.85 3.6-4.94 6.73-4.94z"
      />
    </svg>
  )
}

function AppleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 fill-neutral-300">
      <path d="M16.365 1.43c0 1.14-.493 2.27-1.177 3.08-.744.9-1.99 1.57-2.987 1.57-.12 0-.23-.02-.3-.03-.01-.06-.04-.22-.04-.39 0-1.15.572-2.27 1.206-2.98.804-.94 2.142-1.64 3.248-1.68.03.13.05.28.05.43zm4.565 15.71c-.03.07-.463 1.58-1.518 3.12-.945 1.34-1.94 2.71-3.43 2.71-1.517 0-1.9-.88-3.63-.88-1.698 0-2.302.91-3.67.91-1.377 0-2.332-1.26-3.428-2.8-1.287-1.82-2.146-4.09-2.146-6.25 0-3.67 2.354-5.61 4.664-5.61 1.257 0 2.298.87 3.087.87.755 0 1.933-.92 3.375-.92.53 0 2.434.05 3.687 1.85-.096.06-2.196 1.29-2.196 3.94 0 3.03 2.6 4.09 2.65 4.11z" />
    </svg>
  )
}

function SocialLogins() {
  return (
    <>
      <div className="flex items-center gap-3 py-1">
        <div className="h-px flex-1 bg-neutral-800" />
        <span className="text-xs text-neutral-500">or continue with</span>
        <div className="h-px flex-1 bg-neutral-800" />
      </div>
      <div className="flex gap-3">
        <button type="button" className={socialButtonClass} aria-label="Continue with GitHub">
          <GitHubIcon />
        </button>
        <button type="button" className={socialButtonClass} aria-label="Continue with Google">
          <GoogleIcon />
        </button>
        <button type="button" className={socialButtonClass} aria-label="Continue with Apple">
          <AppleIcon />
        </button>
      </div>
    </>
  )
}

export default function Navbar({ searchValue, onSearchChange }: NavbarProps) {
  const location = useLocation()
  const isAdminRoute = location.pathname.startsWith('/admin')
  const loggedIn = useAuthStore((s) => s.loggedIn)
  const card = useAuthStore((s) => s.card)
  const modal = useAuthStore((s) => s.modal)
  const prompt = useAuthStore((s) => s.prompt)
  const login = useAuthStore((s) => s.login)
  const logout = useAuthStore((s) => s.logout)
  const adminLogout = useAdminAuthStore((s) => s.logout)
  const setCard = useAuthStore((s) => s.setCard)
  const openModal = useAuthStore((s) => s.openModal)
  const closeStoreModal = useAuthStore((s) => s.closeModal)

  const usageHistory = useUsageStore((s) => s.history)
  const [showUsageModal, setShowUsageModal] = useState(false)

  const [signInError, setSignInError] = useState('')
  const [signUpDone, setSignUpDone] = useState(false)
  const [editingCard, setEditingCard] = useState(false)
  const [cardNumber, setCardNumber] = useState(TEST_CARD_NUMBER)
  const [expiry, setExpiry] = useState(TEST_CARD_EXPIRY)
  const [cvc, setCvc] = useState(TEST_CARD_CVC)
  const [cardError, setCardError] = useState('')
  const [revealed, setRevealed] = useState(false)

  function closeModal() {
    closeStoreModal()
    setSignInError('')
    setSignUpDone(false)
    setEditingCard(false)
    setCardNumber(TEST_CARD_NUMBER)
    setExpiry(TEST_CARD_EXPIRY)
    setCvc(TEST_CARD_CVC)
    setCardError('')
    setRevealed(false)
  }

  function handleSignIn(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const email = String(form.get('email') ?? '')
    const password = String(form.get('password') ?? '')

    if (email.toLowerCase() === DEMO_EMAIL.toLowerCase() && password === DEMO_PASSWORD) {
      login()
      closeModal()
    } else {
      setSignInError('Invalid email or password.')
    }
  }

  function handleSignUp(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setSignUpDone(true)
  }

  function handleSaveCard(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()

    if (!isCardNumberValid(cardNumber)) {
      setCardError('Enter a valid card number.')
      return
    }
    if (!isExpiryValid(expiry)) {
      setCardError('Enter a valid, non-expired MM/YY.')
      return
    }
    if (!isCvcValid(cvc)) {
      setCardError('Enter a valid 3-4 digit CVC.')
      return
    }

    const name = String(new FormData(e.currentTarget).get('cardName') ?? '')
    setCard({ name, number: cardNumber, expiry })
    closeModal()
  }

  return (
    <>
      <header className="flex items-center justify-between gap-4 border-b border-neutral-800 px-8 py-5">
        <Link to="/" className="flex shrink-0 items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-pink-600">
            <Sparkles className="h-4 w-4 text-white" />
          </div>
          <span className="brand-logo text-2xl font-bold tracking-tight text-white">PayHive</span>
        </Link>

        {onSearchChange && (
          <div className="relative hidden w-full max-w-xs flex-1 sm:block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500" />
            <input
              value={searchValue}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search agents…"
              className="w-full rounded-lg border border-neutral-800 bg-neutral-900 py-2 pl-9 pr-3 text-sm text-white placeholder-neutral-500 outline-none transition focus:border-pink-500/60 focus:ring-2 focus:ring-pink-500/15"
            />
          </div>
        )}

        <div className="flex shrink-0 items-center gap-3">
          {isAdminRoute && <AdminWalletCard />}

          {loggedIn && !isAdminRoute && (
            <button
              onClick={() => setShowUsageModal(true)}
              aria-label="Usage history"
              className="cursor-pointer rounded-lg border border-neutral-700 p-2.5 text-neutral-300 transition hover:border-pink-500 hover:text-pink-400"
            >
              <Clock className="h-4 w-4" />
            </button>
          )}

          {loggedIn && !isAdminRoute && (
            <button
              onClick={() => openModal('wallet')}
              aria-label="Wallet"
              className="relative cursor-pointer rounded-lg border border-neutral-700 p-2.5 text-neutral-300 transition hover:border-pink-500 hover:text-pink-400"
            >
              <Wallet className="h-4 w-4" />
              {card && <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-pink-500" />}
            </button>
          )}

          {isAdminRoute ? (
            <button
              onClick={adminLogout}
              className="cursor-pointer rounded-lg border border-neutral-700 px-4 py-2 text-sm text-neutral-300 transition hover:border-pink-500 hover:text-pink-400"
            >
              Log out
            </button>
          ) : loggedIn ? (
            <button
              onClick={logout}
              className="cursor-pointer rounded-lg border border-neutral-700 px-4 py-2 text-sm text-neutral-300 transition hover:border-pink-500 hover:text-pink-400"
            >
              Log out
            </button>
          ) : (
            <button
              onClick={() => openModal('signin')}
              className="cursor-pointer rounded-lg border border-neutral-700 px-4 py-2 text-sm text-neutral-300 transition hover:border-pink-500 hover:text-pink-400"
            >
              Sign in
            </button>
          )}
        </div>
      </header>

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm">
          <div className="modal-in w-full max-w-sm rounded-2xl border border-neutral-800 bg-neutral-900 p-6">
            <div className="mb-1 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">
                {modal === 'signin' ? 'Sign in' : modal === 'signup' ? 'Create account' : 'Payment card'}
              </h2>
              <button onClick={closeModal} className="cursor-pointer text-neutral-500 transition hover:text-white">
                <X className="h-5 w-5" />
              </button>
            </div>

            {prompt && <p className="mb-4 text-xs text-neutral-500">{prompt}</p>}
            {!prompt && <div className="mb-5" />}

            {modal === 'signin' && (
              <form onSubmit={handleSignIn} className="flex flex-col gap-3">
                <input name="email" type="email" placeholder="Email" autoComplete="email" className={inputClass} />
                <input
                  name="password"
                  type="password"
                  placeholder="Password"
                  autoComplete="current-password"
                  className={inputClass}
                />
                {signInError && <p className="text-xs text-red-400">{signInError}</p>}
                <button
                  type="submit"
                  className="cursor-pointer rounded-lg bg-pink-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-pink-500"
                >
                  Sign in
                </button>
                <p className="text-center text-xs text-neutral-500">
                  Don't have an account?{' '}
                  <button
                    type="button"
                    onClick={() => {
                      openModal('signup')
                      setSignInError('')
                    }}
                    className="cursor-pointer text-pink-400 hover:underline"
                  >
                    Create one
                  </button>
                </p>
                <SocialLogins />
              </form>
            )}

            {modal === 'signup' && !signUpDone && (
              <form onSubmit={handleSignUp} className="flex flex-col gap-3">
                <input name="name" placeholder="Full name" required className={inputClass} />
                <input name="email" type="email" placeholder="Email" required className={inputClass} />
                <input name="password" type="password" placeholder="Password" required className={inputClass} />
                <button
                  type="submit"
                  className="cursor-pointer rounded-lg bg-pink-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-pink-500"
                >
                  Create account
                </button>
                <p className="text-center text-xs text-neutral-500">
                  Already have an account?{' '}
                  <button
                    type="button"
                    onClick={() => openModal('signin')}
                    className="cursor-pointer text-pink-400 hover:underline"
                  >
                    Sign in
                  </button>
                </p>
                <SocialLogins />
              </form>
            )}

            {modal === 'signup' && signUpDone && (
              <div className="flex flex-col items-center gap-3 py-2 text-center">
                <p className="text-sm text-neutral-300">Account created. Use the demo login to sign in:</p>
                <p className="text-sm font-medium text-pink-300">
                  {DEMO_EMAIL} / {DEMO_PASSWORD}
                </p>
                <button
                  onClick={() => {
                    openModal('signin')
                    setSignUpDone(false)
                  }}
                  className="mt-2 w-full cursor-pointer rounded-lg bg-pink-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-pink-500"
                >
                  Go to sign in
                </button>
              </div>
            )}

            {modal === 'wallet' &&
              (card && !editingCard ? (
                <div className="flex flex-col gap-4">
                  <div className="flex items-center gap-3 rounded-xl border border-neutral-800 bg-neutral-950 p-4">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-pink-500/10">
                      <CreditCard className="h-5 w-5 text-pink-400" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-mono text-sm font-medium text-white">
                        {revealed ? card.number : `•••• •••• •••• ${card.number.replace(/\s+/g, '').slice(-4)}`}
                      </p>
                      <p className="truncate text-xs text-neutral-500">
                        {revealed ? `${card.name} · Exp ${card.expiry}` : 'Card on file'}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setRevealed((v) => !v)}
                      aria-label={revealed ? 'Hide card details' : 'Show card details'}
                      className="cursor-pointer text-neutral-500 transition hover:text-pink-400"
                    >
                      {revealed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => setEditingCard(true)}
                    className="cursor-pointer rounded-lg border border-neutral-700 px-4 py-2.5 text-sm text-neutral-300 transition hover:border-pink-500 hover:text-pink-400"
                  >
                    Replace card
                  </button>
                </div>
              ) : (
                <form onSubmit={handleSaveCard} className="flex flex-col gap-3" autoComplete="off">
                  <input
                    name="cardName"
                    placeholder="Name on card"
                    defaultValue={TEST_CARD_NAME}
                    required
                    autoComplete="off"
                    className={inputClass}
                  />
                  <input
                    name="cardNumber"
                    placeholder="Card number"
                    inputMode="numeric"
                    autoComplete="off"
                    value={cardNumber}
                    onChange={(e) => setCardNumber(formatCardNumber(e.target.value))}
                    className={inputClass}
                  />
                  <div className="flex gap-3">
                    <input
                      name="expiry"
                      placeholder="MM/YY"
                      inputMode="numeric"
                      autoComplete="off"
                      value={expiry}
                      onChange={(e) => setExpiry(formatExpiry(e.target.value))}
                      className={halfInputClass}
                    />
                    <input
                      name="cvc"
                      placeholder="CVC"
                      inputMode="numeric"
                      autoComplete="off"
                      value={cvc}
                      onChange={(e) => setCvc(e.target.value.replace(/\D/g, '').slice(0, 4))}
                      className={halfInputClass}
                    />
                  </div>
                  {cardError && <p className="text-xs text-red-400">{cardError}</p>}
                  <button
                    type="submit"
                    className="cursor-pointer rounded-lg bg-pink-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-pink-500"
                  >
                    Save card
                  </button>
                </form>
              ))}
          </div>
        </div>
      )}

      {showUsageModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm">
          <div className="modal-in w-full max-w-md rounded-2xl border border-neutral-800 bg-neutral-900 p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">Usage history</h2>
              <button
                onClick={() => setShowUsageModal(false)}
                className="cursor-pointer text-neutral-500 transition hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mb-4 rounded-xl border border-neutral-800 bg-neutral-950 p-4">
              <p className="text-xs text-neutral-500">Total charged</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-pink-400">
                ${usageHistory.reduce((sum, e) => sum + e.cost, 0).toFixed(2)}
              </p>
              <p className="mt-1 text-xs text-neutral-600">
                {usageHistory.length} {usageHistory.length === 1 ? 'session' : 'sessions'}
              </p>
            </div>

            {usageHistory.length === 0 ? (
              <p className="py-6 text-center text-sm text-neutral-500">No sessions yet.</p>
            ) : (
              <div className="max-h-72 space-y-2 overflow-y-auto">
                {usageHistory.map((entry) => (
                  <div
                    key={entry.id}
                    className="flex items-center justify-between rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm text-white">{entry.agentName}</p>
                      <p className="text-xs text-neutral-500">
                        {entry.calls} {entry.calls === 1 ? 'call' : 'calls'} ·{' '}
                        {new Date(entry.endedAt).toLocaleString()}
                      </p>
                    </div>
                    <p className="shrink-0 text-sm font-semibold tabular-nums text-pink-300">
                      ${entry.cost.toFixed(2)}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}

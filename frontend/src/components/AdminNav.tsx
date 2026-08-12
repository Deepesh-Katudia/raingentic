import { NavLink } from 'react-router-dom'
import { cn } from '@/lib/utils'

const TABS = [
  { to: '/admin', label: 'Overview' },
  { to: '/admin/ledger', label: 'Ledger' },
  { to: '/admin/spend', label: 'Spend Agent' },
]

export default function AdminNav() {
  return (
    <div className="border-b border-neutral-800 px-6">
      <nav className="mx-auto flex max-w-5xl gap-6">
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.to === '/admin'}
            className={({ isActive }) =>
              cn(
                'border-b-2 py-3 text-sm font-medium transition',
                isActive
                  ? 'border-pink-500 text-white'
                  : 'border-transparent text-neutral-500 hover:text-neutral-300',
              )
            }
          >
            {tab.label}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}

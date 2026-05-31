import { useState } from 'react'
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '../../store/auth.store'
import { useCanAccess } from '../../hooks/useCanAccess'

const NAV_LINKS = [
  { to: '/children',        label: 'Діти' },
  { to: '/activities',      label: 'Активності' },
  { to: '/journals',        label: 'Журнали' },
  { to: '/calendar',        label: 'Календар' },
  { to: '/staff',           label: 'Персонал' },
  { to: '/salary/journal',  label: 'Журнал ЗП' },
  { to: '/accounts',        label: 'Рахунки' },
  { to: '/expenses',        label: 'Витрати' },
  { to: '/reports',         label: 'Звіти' },
]

const DUTY_ADMIN_LINKS = new Set(['/journals', '/calendar'])

export function AppLayout() {
  const { user, logout } = useAuthStore()
  const navigate = useNavigate()
  const location = useLocation()
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  
  const isDutyAdmin     = user?.role === 'duty_admin'
  const isParent        = user?.role === 'parent'
  const canManageGroups = useCanAccess('owner', 'admin')
  const canManageUsers  = useCanAccess('owner', 'admin')
  const isOwner = useCanAccess('owner')

  const visibleLinks = isDutyAdmin
    ? NAV_LINKS.filter(l => DUTY_ADMIN_LINKS.has(l.to))
    : isParent
      ? []
      : NAV_LINKS

  // When embedded in an iframe (e.g. opened from calendar modal), hide navigation
  const isEmbedded = new URLSearchParams(location.search).get('layout') === 'none'
  if (isEmbedded) {
    return (
      <div className="min-h-screen bg-gray-50">
        <main className="max-w-screen-xl mx-auto px-4 py-4">
          <Outlet />
        </main>
      </div>
    )
  }

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-40">
        <div className="max-w-screen-xl mx-auto px-4 flex items-center justify-between h-14">
          {/* Logo & Hamburger */}
          <div className="flex items-center gap-4 md:gap-6">
            <button
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className="md:hidden p-1.5 -ml-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-md transition-colors"
              aria-label="Toggle mobile menu"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <span className="font-bold text-iris-600 text-lg tracking-tight">IRIS</span>

            {/* Nav (Desktop) */}
            <nav className="hidden md:flex items-center gap-1">
              {visibleLinks.map(({ to, label }) => (
                <NavLink
                  key={to}
                  to={to}
                  className={({ isActive }) =>
                    `px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                      isActive
                        ? 'bg-iris-50 text-iris-700'
                        : 'text-gray-600 hover:bg-gray-100'
                    }`
                  }
                >
                  {label}
                </NavLink>
              ))}
              {canManageGroups && (
                <NavLink
                  to="/groups"
                  className={({ isActive }) =>
                    `px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                      isActive
                        ? 'bg-iris-50 text-iris-700'
                        : 'text-gray-600 hover:bg-gray-100'
                    }`
                  }
                >
                  Групи
                </NavLink>
              )}
              {canManageUsers && (
                <NavLink
                  to="/users"
                  className={({ isActive }) =>
                    `px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                      isActive
                        ? 'bg-iris-50 text-iris-700'
                        : 'text-gray-600 hover:bg-gray-100'
                    }`
                  }
                >
                  Користувачі
                </NavLink>
              )}
              {isOwner && (
                <NavLink
                  to="/dividends"
                  className={({ isActive }) =>
                    `px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                      isActive
                        ? 'bg-iris-50 text-iris-700'
                        : 'text-gray-600 hover:bg-gray-100'
                    }`
                  }
                >
                  Дивіденди
                </NavLink>
              )}
            </nav>
          </div>

          {/* User */}
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-500 hidden sm:block">
              {user?.email} · <span className="font-medium">{user?.role}</span>
            </span>
            <button
              onClick={handleLogout}
              className="text-sm text-gray-500 hover:text-gray-900 transition-colors"
            >
              Вийти
            </button>
          </div>
        </div>

        {/* Mobile Menu Dropdown */}
        {isMobileMenuOpen && (
          <div className="md:hidden border-t border-gray-100 bg-white absolute w-full left-0 z-30 shadow-md">
            <nav className="flex flex-col p-2 space-y-1">
              {visibleLinks.map(({ to, label }) => (
                <NavLink
                  key={to}
                  to={to}
                  onClick={() => setIsMobileMenuOpen(false)}
                  className={({ isActive }) =>
                    `px-4 py-2 rounded-md text-base font-medium transition-colors ${
                      isActive
                        ? 'bg-iris-50 text-iris-700'
                        : 'text-gray-600 hover:bg-gray-50'
                    }`
                  }
                >
                  {label}
                </NavLink>
              ))}
              {canManageGroups && (
                <NavLink
                  to="/groups"
                  onClick={() => setIsMobileMenuOpen(false)}
                  className={({ isActive }) =>
                    `px-4 py-2 rounded-md text-base font-medium transition-colors ${
                      isActive
                        ? 'bg-iris-50 text-iris-700'
                        : 'text-gray-600 hover:bg-gray-50'
                    }`
                  }
                >
                  Групи
                </NavLink>
              )}
              {canManageUsers && (
                <NavLink
                  to="/users"
                  onClick={() => setIsMobileMenuOpen(false)}
                  className={({ isActive }) =>
                    `px-4 py-2 rounded-md text-base font-medium transition-colors ${
                      isActive
                        ? 'bg-iris-50 text-iris-700'
                        : 'text-gray-600 hover:bg-gray-50'
                    }`
                  }
                >
                  Користувачі
                </NavLink>
              )}
              {isOwner && (
                <NavLink
                  to="/dividends"
                  onClick={() => setIsMobileMenuOpen(false)}
                  className={({ isActive }) =>
                    `px-4 py-2 rounded-md text-base font-medium transition-colors ${
                      isActive
                        ? 'bg-iris-50 text-iris-700'
                        : 'text-gray-600 hover:bg-gray-50'
                    }`
                  }
                >
                  Дивіденди
                </NavLink>
              )}
            </nav>
          </div>
        )}
      </header>

      {/* Content */}
      <main className="max-w-screen-xl mx-auto px-4 py-6">
        <Outlet />
      </main>
    </div>
  )
}

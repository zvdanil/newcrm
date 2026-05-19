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

export function AppLayout() {
  const { user, logout } = useAuthStore()
  const navigate = useNavigate()
  const location = useLocation()
  const canManageGroups = useCanAccess('owner', 'admin')
  const isOwner = useCanAccess('owner')

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
          {/* Logo */}
          <div className="flex items-center gap-6">
            <span className="font-bold text-iris-600 text-lg tracking-tight">IRIS</span>

            {/* Nav */}
            <nav className="hidden md:flex items-center gap-1">
              {NAV_LINKS.map(({ to, label }) => (
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
      </header>

      {/* Content */}
      <main className="max-w-screen-xl mx-auto px-4 py-6">
        <Outlet />
      </main>
    </div>
  )
}

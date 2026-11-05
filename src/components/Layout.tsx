import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { ROLE_LABEL } from '../lib/labels'

export function Layout() {
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()

  async function logout() {
    await signOut()
    navigate('/login', { replace: true })
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <svg className="brand-logo" viewBox="0 0 24 24">
              <path
                fill="currentColor"
                fillRule="evenodd"
                d="M4.15 9.4 12 3.05l7.85 6.35V20.8H4.15V9.4Zm3.2 2.15h2.5v2.4h-2.5v-2.4Zm6.8 0h2.5v2.4h-2.5v-2.4ZM10.6 15.35h2.8V20.8h-2.8v-5.45Z"
              />
            </svg>
          </span>
          <span className="brand-text">Объекты и задачи</span>
        </div>
        <nav className="nav">
          <NavLink to="/objects" className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
            Объекты
          </NavLink>
          {profile?.role === 'executor' && (
            <NavLink
              to="/my-tasks"
              className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
            >
              Мои задачи
            </NavLink>
          )}
        </nav>
        <div className="userbox">
          <div className="user-id">
            <span className="user-avatar" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <circle cx="12" cy="8" r="3.15" fill="currentColor" />
                <path
                  fill="currentColor"
                  d="M6.15 18.85c.72-3.2 3-4.75 5.85-4.75s5.13 1.55 5.85 4.75c.14.64-.36 1.2-1.02 1.2H7.17c-.66 0-1.16-.56-1.02-1.2Z"
                />
              </svg>
            </span>
            <div className="user-meta">
              <strong>{profile?.full_name}</strong>
              {profile && <span className="role-pill">{ROLE_LABEL[profile.role]}</span>}
            </div>
          </div>
          <button type="button" className="btn btn-ghost" onClick={() => void logout()}>
            Выйти
          </button>
        </div>
      </header>
      <main className="content">
        <Outlet />
      </main>
    </div>
  )
}

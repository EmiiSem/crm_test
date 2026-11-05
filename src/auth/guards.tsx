import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from './AuthProvider'

export function ProtectedRoute() {
  const { loading, session, profile } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div className="gate">
        <p>Загрузка…</p>
      </div>
    )
  }

  if (!session) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }

  if (!profile) {
    return (
      <div className="gate">
        <div className="gate-card">
          <h1>Профиль не найден</h1>
          <p>Учётная запись есть, но в базе нет сотрудника. Профиль создаёт администратор.</p>
        </div>
      </div>
    )
  }

  return <Outlet />
}

export function AssignerRoute() {
  const { profile } = useAuth()
  if (profile?.role !== 'assigner') return <Navigate to="/objects" replace />
  return <Outlet />
}

export function ExecutorRoute() {
  const { profile } = useAuth()
  if (profile?.role !== 'executor') return <Navigate to="/objects" replace />
  return <Outlet />
}

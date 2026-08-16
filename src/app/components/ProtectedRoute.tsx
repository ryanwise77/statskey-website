import { Navigate, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useAuth } from '../lib/auth'

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, nudgeAuthor, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div className="sk-boot">
        <div>
          <b>StatsKey</b>
          <span aria-hidden="true" />
        </div>
      </div>
    )
  }

  if (!user) {
    const isDesktop = 'statsKeyDesktop' in window
    const localDesktopRoute =
      isDesktop &&
      (location.pathname === '/' ||
        location.pathname === '/workspace' ||
        location.pathname === '/cad' ||
        location.pathname === '/calendar' ||
        location.pathname === '/tasks' ||
        location.pathname === '/models' ||
        location.pathname === '/customize' ||
        location.pathname.startsWith('/settings') ||
        location.pathname === '/flow/history' ||
        (location.pathname === '/flow' &&
          new URLSearchParams(location.search).get('scope') === 'work'))
    if (localDesktopRoute) return <>{children}</>
    return <Navigate to="/login" replace state={{ from: location }} />
  }

  if (nudgeAuthor) {
    return <Navigate to="/nudge-studio" replace />
  }

  return <>{children}</>
}

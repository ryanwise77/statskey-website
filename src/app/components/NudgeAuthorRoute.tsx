import { Navigate, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useAuth } from '../lib/auth'

export function NudgeAuthorRoute({ children }: { children: ReactNode }) {
  const { user, nudgeAuthor, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-text-secondary text-sm">
        Opening Nudge Studio…
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />
  }

  if (!nudgeAuthor) {
    return <Navigate to="/" replace />
  }

  return <>{children}</>
}

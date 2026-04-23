import { Navigate, Route, Routes } from 'react-router-dom'
import { Login } from './routes/Login'
import { Dashboard } from './routes/Dashboard'
import { Profile } from './routes/Profile'
import { ProtectedRoute } from './components/ProtectedRoute'
import { Shell } from './components/Shell'
import { useAuth } from './lib/auth'

export function App() {
  const { loading } = useAuth()

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-text-secondary text-sm">
        Loading…
      </div>
    )
  }

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        element={
          <ProtectedRoute>
            <Shell />
          </ProtectedRoute>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="profile" element={<Profile />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

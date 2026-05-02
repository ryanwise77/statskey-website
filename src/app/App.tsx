import { Navigate, Route, Routes } from 'react-router-dom'
import { Login } from './routes/Login'
import { Dashboard } from './routes/Dashboard'
import { Profile } from './routes/Profile'
import { History } from './routes/History'
import { MealDetail } from './routes/MealDetail'
import { WorkoutDetail } from './routes/WorkoutDetail'
import { Record } from './routes/Record'
import { Flow } from './routes/Flow'
import { FlowHistory } from './routes/FlowHistory'
import { Friends } from './routes/Friends'
import { MessageThread } from './routes/MessageThread'
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
        <Route path="record" element={<Record />} />
        <Route path="flow" element={<Flow />} />
        <Route path="flow/history" element={<FlowHistory />} />
        <Route path="friends" element={<Friends />} />
        <Route path="messages/:uid" element={<MessageThread />} />
        <Route path="history" element={<History />} />
        <Route path="meals/:id" element={<MealDetail />} />
        <Route path="workouts/:ownerUid/:id" element={<WorkoutDetail />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

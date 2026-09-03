import { Navigate, Route, Routes } from 'react-router-dom'
import { Login } from './routes/Login'
import { Dashboard } from './routes/Dashboard'
import { Profile } from './routes/Profile'
import { History } from './routes/History'
import { Insights } from './routes/Insights'
import { Library } from './routes/Library'
import { MealDetail } from './routes/MealDetail'
import { WellnessDetail } from './routes/WellnessDetail'
import { WorkoutDetail } from './routes/WorkoutDetail'
import { Record } from './routes/Record'
import { Flow } from './routes/Flow'
import { FlowHistory } from './routes/FlowHistory'
import { Reports, ReportDetail } from './routes/Reports'
import { Friends } from './routes/Friends'
import { FriendDetail } from './routes/FriendDetail'
import { MessageThread } from './routes/MessageThread'
import { TrainingRoutes } from './routes/TrainingRoutes'
import { Tokens, TokensTest } from './routes/Tokens'
import { WorkbenchAuth } from './routes/WorkbenchAuth'
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
      {/* iOS "Manage re-up on web" opens /app/workbench-auth?embed=1&next=/tokens
          with a one-time handoff code in the URL fragment; the route consumes
          it via consumeWebSignInHandoff and continues to `next`. */}
      <Route path="/workbench-auth" element={<WorkbenchAuth />} />
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
        <Route path="insights" element={<Insights />} />
        <Route path="library" element={<Library />} />
        <Route path="flow" element={<Flow />} />
        <Route path="flow/history" element={<FlowHistory />} />
        <Route path="reports" element={<Reports />} />
        <Route path="reports/:id" element={<ReportDetail />} />
        <Route path="tokens" element={<Tokens />} />
        <Route path="tokens-test" element={<TokensTest />} />
        <Route path="friends" element={<Friends />} />
        <Route path="friends/:uid" element={<FriendDetail />} />
        <Route path="routes" element={<TrainingRoutes />} />
        <Route path="messages/:uid" element={<MessageThread />} />
        <Route path="history" element={<History />} />
        <Route path="meals/:id" element={<MealDetail />} />
        <Route path="wellness/:id" element={<WellnessDetail />} />
        <Route path="workouts/:ownerUid/:id" element={<WorkoutDetail />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

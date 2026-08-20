import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { Login } from './routes/Login'
import { ProtectedRoute } from './components/ProtectedRoute'
import { NudgeAuthorRoute } from './components/NudgeAuthorRoute'
import { Shell } from './components/Shell'
import { DesktopUpdater } from './components/DesktopUpdater'
import { ErrorBoundary } from './components/ErrorBoundary'
import { DialogHost, ToastHost } from './lib/ui/dialogs'
import { IntelligenceConsentGate } from './components/assistant/IntelligenceConsentGate'
import { LocalWorkIntelligenceGate } from './components/assistant/LocalWorkIntelligenceGate'
import { useAuth } from './lib/auth'
import {
  desktopLaunchRoute,
  loadDesktopChatTabs,
  loadClosedDesktopChatTabIds,
} from './lib/desktopChatTabs'

const Dashboard = lazy(() =>
  import('./routes/Dashboard').then((module) => ({ default: module.Dashboard }))
)
const Profile = lazy(() =>
  import('./routes/Profile').then((module) => ({ default: module.Profile }))
)
const History = lazy(() =>
  import('./routes/History').then((module) => ({ default: module.History }))
)
const Insights = lazy(() =>
  import('./routes/Insights').then((module) => ({ default: module.Insights }))
)
const Health = lazy(() =>
  import('./routes/Health').then((module) => ({ default: module.Health }))
)
const Library = lazy(() =>
  import('./routes/Library').then((module) => ({ default: module.Library }))
)
const Workspace = lazy(() =>
  import('./routes/Workspace').then((module) => ({ default: module.Workspace }))
)
const Browser = lazy(() =>
  import('./routes/Browser').then((module) => ({ default: module.Browser }))
)
const Simulator = lazy(() =>
  import('./routes/Simulator').then((module) => ({ default: module.Simulator }))
)
const Cad = lazy(() =>
  import('./routes/Cad').then((module) => ({ default: module.Cad }))
)
const GitHubWorkspace = lazy(() =>
  import('./components/workspace/GitHubCloudWorkspace').then((module) => ({
    default: module.GitHubCloudWorkspace,
  }))
)
const Planning = lazy(() =>
  import('./routes/Planning').then((module) => ({
    default: module.Planning,
  }))
)
const Calendar = lazy(() =>
  import('./routes/Calendar').then((module) => ({
    default: module.Calendar,
  }))
)
const Fleet = lazy(() =>
  import('./routes/Fleet').then((module) => ({
    default: module.Fleet,
  }))
)
const Cockpit = lazy(() =>
  import('./routes/Cockpit').then((module) => ({
    default: module.Cockpit,
  }))
)
const FleetRemote = lazy(() =>
  import('./routes/FleetRemote').then((module) => ({
    default: module.FleetRemote,
  }))
)
const Jobs = lazy(() =>
  import('./routes/Fleet').then((module) => ({
    default: module.Jobs,
  }))
)
const Settings = lazy(() =>
  import('./routes/Settings').then((module) => ({
    default: module.Settings,
  }))
)
const MealDetail = lazy(() =>
  import('./routes/MealDetail').then((module) => ({ default: module.MealDetail }))
)
const WellnessDetail = lazy(() =>
  import('./routes/WellnessDetail').then((module) => ({ default: module.WellnessDetail }))
)
const WorkoutDetail = lazy(() =>
  import('./routes/WorkoutDetail').then((module) => ({ default: module.WorkoutDetail }))
)
const Record = lazy(() =>
  import('./routes/Record').then((module) => ({ default: module.Record }))
)
const Flow = lazy(() =>
  import('./routes/Flow').then((module) => ({ default: module.Flow }))
)
const FlowHistory = lazy(() =>
  import('./routes/FlowHistory').then((module) => ({ default: module.FlowHistory }))
)
const Reports = lazy(() =>
  import('./routes/Reports').then((module) => ({ default: module.Reports }))
)
const ReportDetail = lazy(() =>
  import('./routes/Reports').then((module) => ({ default: module.ReportDetail }))
)
const Friends = lazy(() =>
  import('./routes/Friends').then((module) => ({ default: module.Friends }))
)
const FriendDetail = lazy(() =>
  import('./routes/FriendDetail').then((module) => ({ default: module.FriendDetail }))
)
const MessageThread = lazy(() =>
  import('./routes/MessageThread').then((module) => ({ default: module.MessageThread }))
)
const TrainingRoutes = lazy(() =>
  import('./routes/TrainingRoutes').then((module) => ({ default: module.TrainingRoutes }))
)
const Tokens = lazy(() =>
  import('./routes/Tokens').then((module) => ({ default: module.Tokens }))
)
const TokensTest = lazy(() =>
  import('./routes/Tokens').then((module) => ({ default: module.TokensTest }))
)
const EnterpriseConsole = lazy(() =>
  import('./routes/EnterpriseConsole').then((module) => ({
    default: module.EnterpriseConsole,
  }))
)
const EnterpriseWorkbench = lazy(() =>
  import('./routes/EnterpriseWorkbench').then((module) => ({
    default: module.EnterpriseWorkbench,
  }))
)
const WorkbenchAuth = lazy(() =>
  import('./routes/WorkbenchAuth').then((module) => ({
    default: module.WorkbenchAuth,
  }))
)
const NudgeStudio = lazy(() =>
  import('./routes/NudgeStudio').then((module) => ({
    default: module.NudgeStudio,
  }))
)
function AgentFlowRoute() {
  const location = useLocation()
  const { user } = useAuth()
  const isDesktop = 'statsKeyDesktop' in window

  if (!isDesktop) {
    return <Navigate to="/dashboard" replace />
  }

  const localDesktopWork =
    !user && new URLSearchParams(location.search).get('scope') === 'work'
  if (localDesktopWork) {
    return (
      <LocalWorkIntelligenceGate>
        <Flow key={`${location.pathname}${location.search}`} />
      </LocalWorkIntelligenceGate>
    )
  }
  return (
    <IntelligenceConsentGate>
      <Flow key={`${location.pathname}${location.search}`} />
    </IntelligenceConsentGate>
  )
}

export function App() {
  const { loading } = useAuth()

  if (loading) {
    return (
      <>
        <DesktopUpdater />
        <div className="sk-boot">
          <div>
            <b>StatsKey</b>
            <span aria-hidden="true" />
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      <DesktopUpdater />
      <DialogHost />
      <ToastHost />
      <ErrorBoundary>
      <Suspense
        fallback={
          <div className="sk-boot" style={{ minHeight: '240px' }}>
            <div>
              <b>StatsKey</b>
              <span aria-hidden="true" />
            </div>
          </div>
        }
      >
        <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/agency/nudge-studio"
          element={<Navigate to="/login" replace />}
        />
        <Route path="/workbench-auth" element={<WorkbenchAuth />} />
        <Route
          path="/nudge-studio"
          element={
            <NudgeAuthorRoute>
              <NudgeStudio />
            </NudgeAuthorRoute>
          }
        />
        <Route
          element={
            <ProtectedRoute>
              <Shell />
            </ProtectedRoute>
          }
        >
        <Route index element={<HomeRedirect />} />
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="profile" element={<Profile />} />
        <Route path="record" element={<Record />} />
        <Route path="health" element={<Health />} />
        <Route path="insights" element={<Insights />} />
        <Route path="library" element={<Library />} />
        <Route path="workspace" element={<Workspace />} />
        <Route path="browser" element={<Browser />} />
        <Route path="simulator" element={<Simulator />} />
        <Route path="cad" element={<Cad />} />
        <Route path="github" element={<GitHubWorkspace />} />
        <Route path="plan" element={<Planning />} />
        <Route path="calendar" element={<Calendar />} />
        <Route path="fleet" element={<Fleet />} />
        <Route path="cockpit" element={<Cockpit />} />
        <Route path="fleet/remote" element={<FleetRemote />} />
        <Route path="jobs" element={<Jobs />} />
        <Route path="settings/*" element={<Settings />} />
        {/* Old scattered settings routes stay reachable (deep links and the
            Cmd+, menu command on older builds) as redirects into Settings. */}
        <Route
          path="models"
          element={<Navigate to="/settings/models" replace />}
        />
        <Route
          path="customize"
          element={<Navigate to="/settings/general" replace />}
        />
        <Route path="tasks" element={<Navigate to="/workspace" replace />} />
        <Route path="flow" element={<AgentFlowRoute />} />
        <Route
          path="flow/history"
          element={
            'statsKeyDesktop' in window
              ? <FlowHistory />
              : <Navigate to="/dashboard" replace />
          }
        />
        <Route path="reports" element={<Reports />} />
        <Route path="reports/:id" element={<ReportDetail />} />
        <Route path="tokens" element={<Tokens />} />
        <Route path="tokens-test" element={<TokensTest />} />
        <Route
          path="enterprise"
          element={
            <IntelligenceConsentGate>
              <EnterpriseWorkbench />
            </IntelligenceConsentGate>
          }
        />
        <Route
          path="enterprise/admin"
          element={
            <IntelligenceConsentGate>
              <EnterpriseConsole />
            </IntelligenceConsentGate>
          }
        />
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
      </Suspense>
      </ErrorBoundary>
    </>
  )
}

function HomeRedirect() {
  const { user, nudgeAuthor, profileLoaded } = useAuth()
  const isDesktop = 'statsKeyDesktop' in window

  if (nudgeAuthor) {
    return <Navigate to="/nudge-studio" replace />
  }

  if (isDesktop && !user) {
    return <Navigate to="/workspace" replace />
  }

  if (!profileLoaded) {
    return (
      <div className="min-h-[240px] flex items-center justify-center text-text-secondary text-sm">
        Opening your home…
      </div>
    )
  }

  if (isDesktop) {
    return (
      <Navigate
        to={desktopLaunchRoute(
          loadDesktopChatTabs(),
          loadClosedDesktopChatTabIds()
        )}
        replace
      />
    )
  }

  return <Navigate to="/dashboard" replace />
}

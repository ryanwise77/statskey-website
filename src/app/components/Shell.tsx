import { useEffect, useMemo, useRef, useState } from 'react'
import {
  NavLink,
  Outlet,
  useLocation,
  useNavigate,
  useNavigationType,
} from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { useAssistantActions } from '../lib/data/useAssistantActions'
import {
  AGENT_PREFILL_EVENT,
  getDesktopBridge,
  SUMMON_FOCUS_EVENT,
  type DesktopRecentProject,
  type DesktopWorkspaceState,
  type StatsKeyDesktopBridge,
} from '../lib/desktop'
import { confirmDialog, promptDialog, showToast } from '../lib/ui/dialogs'
import {
  currentProjectBinding,
  projectBindingForWorkspace,
  requestWorkspaceQuickTool,
  sameProjectRoots,
  workspaceImportResultError,
  type WorkspaceProjectBinding,
  type WorkspaceQuickTool,
} from '../lib/workspaceContext'
import {
  AGENT_RUN_STATE_EVENT,
  getActiveAgentRun,
  getActiveAgentRuns,
  getLastAgentScope,
  getLastAgentSessionId,
  hasActiveAgentRunControl,
  requestActiveAgentRunStop,
  type ActiveAgentRun,
  type AgentRunPreview,
  type AgentRunStepSummary,
} from '../lib/agentRunState'
import {
  archiveLocalChatSession,
  CHAT_SESSION_LIFECYCLE_EVENT,
  clearAgentLocalState,
  deleteLocalChatSession,
  loadAgentLocalState,
  loadLocalChatSession,
  saveAgentLocalState,
  saveLocalChatSession,
} from '../lib/agentLocalState'
import {
  deleteChatSession,
  saveChatSession,
  useRecentChatSessions,
  type ChatSession,
} from '../lib/data/useChatSessions'
import {
  mergeChatSessions,
  useRecentLocalChatSessions,
} from '../lib/data/useLocalChatSessions'
import { agentModeLabel } from '../lib/ai/agentModePresentation'
import { forkChatPlanCanvases } from '../lib/planCanvasChat'
import { DesktopBridge } from './DesktopBridge'
import { DesktopOperationGate } from './DesktopOperationGate'
import { checkForDesktopUpdates } from './DesktopUpdater'
import { RemoteAccessCoordinator } from './RemoteAccessCoordinator'
import { RemoteAccessOnboardingPrompt } from './RemoteAccessSettings'
import {
  DESKTOP_CHAT_TABS_KEY,
  DESKTOP_CLOSED_CHAT_TABS_KEY,
  MAX_DESKTOP_CHAT_TABS,
  desktopNeutralChatRoute,
  loadClosedDesktopChatTabIds,
  loadDesktopChatTabs,
  safeOldDesktopChatTabIds,
  safeOtherDesktopChatTabIds,
  shouldOpenRequestedDesktopChatTab,
  withClosedDesktopChatTab,
  withoutClosedDesktopChatTab,
  type DesktopChatTab,
} from '../lib/desktopChatTabs'
import {
  DESKTOP_SURFACE_STORAGE_KEY,
  desktopOpenTabMenuEntries,
  loadDesktopSurfaceTabs,
  type DesktopSurfaceId,
} from '../lib/desktopSurfaceTabs'
import './ShellDesktopLocked.css'
import './DesktopExperience.css'

const NAV_ITEMS: { to: string; label: string; end?: boolean }[] = [
  { to: '/dashboard', label: 'Dashboard', end: true },
  { to: '/record', label: 'Record' },
  { to: '/insights', label: 'Insights' },
  { to: '/library', label: 'Library' },
  { to: '/friends', label: 'Friends' },
  { to: '/routes', label: 'Routes' },
  { to: '/history', label: 'History' },
  { to: '/tokens', label: 'Store' },
  { to: '/profile', label: 'Profile' },
]

type DesktopIcon =
  | 'ask'
  | 'workspace'
  | 'browser'
  | 'simulator'
  | 'cad'
  | 'github'
  | 'plan'
  | 'calendar'
  | 'tasks'
  | 'today'
  | 'record'
  | 'insights'
  | 'library'
  | 'history'
  | 'people'
  | 'routes'
  | 'store'
  | 'models'
  | 'enterprise'
  | 'founder'
  | 'settings'
  | 'more'
  | 'lock'

type DesktopNavItem = {
  to: string
  label: string
  icon: DesktopIcon
  end?: boolean
}

const DESKTOP_PLANNING_ITEMS: DesktopNavItem[] = [
  { to: '/calendar', label: 'Calendar', icon: 'calendar' },
  { to: '/plan', label: 'Plan', icon: 'plan' },
]

const DESKTOP_HEALTH_ITEMS: DesktopNavItem[] = [
  { to: '/health', label: 'Overview', icon: 'today' },
  { to: '/dashboard', label: 'Today', icon: 'today' },
  { to: '/record', label: 'Record', icon: 'record' },
  { to: '/insights', label: 'Insights', icon: 'insights' },
  { to: '/library', label: 'Library', icon: 'library' },
]

const DESKTOP_MORE_ITEMS: DesktopNavItem[] = [
  { to: '/cad', label: 'Parametric CAD', icon: 'cad' },
  { to: '/github', label: 'GitHub', icon: 'github' },
  // One Settings entry replaces the old scattered Models & keys and
  // Customize links; both live as sections inside /settings now.
  { to: '/settings', label: 'Settings', icon: 'settings' },
  { to: '/history', label: 'Health history', icon: 'history' },
  { to: '/friends', label: 'People', icon: 'people' },
  { to: '/routes', label: 'Routes', icon: 'routes' },
  { to: '/tokens', label: 'Store', icon: 'store' },
]

const DESKTOP_SURFACES: Array<{
  id: DesktopSurfaceId
  to: string
  label: string
  icon: DesktopIcon
}> = [
  { id: 'workspace', to: '/workspace', label: 'Workspace', icon: 'workspace' },
  { id: 'browser', to: '/browser', label: 'Browser', icon: 'browser' },
  { id: 'simulator', to: '/simulator', label: 'Simulator', icon: 'simulator' },
  { id: 'cad', to: '/cad', label: 'CAD', icon: 'cad' },
  { id: 'github', to: '/github', label: 'GitHub', icon: 'github' },
  { id: 'plan', to: '/plan', label: 'Plan', icon: 'plan' },
  { id: 'calendar', to: '/calendar', label: 'Calendar', icon: 'calendar' },
]

// Menu IPC contract: main.cjs sends these string commands over the
// 'statskey-desktop:menu-command' channel; preload exposes onMenuCommand.
// Workspace.tsx listens for the two workspace CustomEvents below. On /github
// the close-tab event is dispatched cancelable: GitHubCloudWorkspace
// preventDefaults it when it has dirty drafts, runs its own confirm, and on
// confirmation dispatches the confirmed event so the surface still closes.
const WORKSPACE_MENU_CLOSE_TAB_EVENT = 'statskey:menu-close-tab'
const MENU_CLOSE_TAB_CONFIRMED_EVENT = 'statskey:menu-close-tab-confirmed'
const WORKSPACE_MENU_SAVE_ALL_EVENT = 'statskey:menu-save-all'
// Internal hand-off from the Shell menu router to the surface bar, which owns
// the tab state and can close the active surface or conversation tab.
const MENU_CLOSE_ACTIVE_TAB_EVENT = 'statskey:menu-close-active-tab'

type MenuCommandBridge = StatsKeyDesktopBridge & {
  onMenuCommand?: (listener: (command: string) => void) => () => void
}

const PRIMARY_INTELLIGENCE_SESSION_KEY =
  'statskey.desktop.primaryIntelligenceSession.v1'
const DESKTOP_SIDEBAR_CHAT_HEIGHT_KEY =
  'statskey.desktop.sidebarChatHeight.v1'
const DEFAULT_DESKTOP_SIDEBAR_CHAT_HEIGHT = 340
const MIN_DESKTOP_SIDEBAR_CHAT_HEIGHT = 120

export function Shell() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const stripRef = useRef<HTMLDivElement>(null)
  const sidebarRef = useRef<HTMLElement>(null)
  const sidebarChatPaneRef = useRef<HTMLDivElement>(null)
  const sidebarChatHeightRef = useRef(loadDesktopSidebarChatHeight())
  const sidebarResizeRef = useRef<{
    pointerId: number
    startY: number
    startHeight: number
  } | null>(null)
  const [sidebarChatHeight, setSidebarChatHeight] = useState(
    sidebarChatHeightRef.current
  )
  const [resizingSidebarChats, setResizingSidebarChats] = useState(false)
  const isDesktop = 'statsKeyDesktop' in window
  const desktopBridge = getDesktopBridge()
  const hasFounderControls = desktopBridge?.founderMode === true
  const isFounderBuild = desktopBridge?.founderBuild === true
  const actions = useAssistantActions(isDesktop ? user?.uid : undefined)
  const isWorkbench =
    location.pathname === '/flow' ||
    location.pathname === '/enterprise' ||
    location.pathname === '/founder' ||
    location.pathname === '/workspace' ||
    location.pathname === '/browser' ||
    location.pathname === '/cad' ||
    location.pathname === '/github' ||
    location.pathname === '/simulator'
  const isHealthSection = DESKTOP_HEALTH_ITEMS.some((item) =>
    location.pathname.startsWith(item.to)
  )

  useEffect(() => {
    if (isFounderBuild) document.title = 'StatsKey Founder'
  }, [isFounderBuild])

  useEffect(() => {
    if (!isDesktop) return
    const openPopoverMenus = () =>
      [
        ...(sidebarRef.current?.querySelectorAll<HTMLDetailsElement>(
          [
            '.desktop-account-actions[open]',
            '.desktop-sidebar__workspace-add[open]',
            '.desktop-chat-group__actions > details[open]',
            '.desktop-chat-item__menu[open]',
          ].join(',')
        ) ?? []),
      ]
    const closeOutside = (event: PointerEvent) => {
      const target = event.target instanceof Node ? event.target : null
      for (const menu of openPopoverMenus()) {
        if (!target || !menu.contains(target)) menu.removeAttribute('open')
      }
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      const menu = openPopoverMenus().at(-1)
      if (!menu) return
      event.preventDefault()
      menu.removeAttribute('open')
      menu.querySelector<HTMLElement>('summary')?.focus()
    }
    document.addEventListener('pointerdown', closeOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [isDesktop])

  // Keep the active pill visible when navigating on small screens. Scrolls
  // only the strip itself — scrollIntoView would also drag the document.
  useEffect(() => {
    const strip = stripRef.current
    if (!strip) return
    const active = strip.querySelector<HTMLElement>('.app-nav-pill.active')
    if (!active) return
    const stripRect = strip.getBoundingClientRect()
    const pillRect = active.getBoundingClientRect()
    const target =
      strip.scrollLeft + (pillRect.left - stripRect.left) - (stripRect.width - pillRect.width) / 2
    strip.scrollTo({ left: Math.max(0, target), behavior: 'smooth' })
  }, [location.pathname])

  // Native application menu commands (File > New Chat, Close Tab, …) arrive
  // through the desktop bridge. Feature-detect so older preloads keep working.
  useEffect(() => {
    if (!isDesktop) return
    const bridge = getDesktopBridge() as MenuCommandBridge | null
    if (!bridge || typeof bridge.onMenuCommand !== 'function') return
    return bridge.onMenuCommand((command) => {
      if (command === 'new-chat') {
        void startNewChat()
        return
      }
      if (command === 'open-settings') {
        navigate('/settings')
        return
      }
      if (command === 'save-all') {
        window.dispatchEvent(new CustomEvent(WORKSPACE_MENU_SAVE_ALL_EVENT))
        return
      }
      if (command === 'close-tab') {
        if (location.pathname.startsWith('/workspace')) {
          window.dispatchEvent(new CustomEvent(WORKSPACE_MENU_CLOSE_TAB_EVENT))
        } else if (location.pathname.startsWith('/github')) {
          // Cancelable: GitHubCloudWorkspace preventDefaults when dirty
          // drafts need a confirm before the surface may close.
          const closeRequest = new CustomEvent(WORKSPACE_MENU_CLOSE_TAB_EVENT, {
            cancelable: true,
          })
          window.dispatchEvent(closeRequest)
          if (!closeRequest.defaultPrevented) {
            window.dispatchEvent(new CustomEvent(MENU_CLOSE_ACTIVE_TAB_EVENT))
          }
        } else {
          window.dispatchEvent(new CustomEvent(MENU_CLOSE_ACTIVE_TAB_EVENT))
        }
      }
    })
    // startNewChat reads isDesktop and user; both are dependencies here, so
    // the subscribed closure never goes stale.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDesktop, location.pathname, user])

  async function handleSignOut() {
    await signOut()
    navigate('/login', { replace: true })
  }

  function openAssistant() {
    if (location.pathname === '/workspace') {
      window.dispatchEvent(new CustomEvent(SUMMON_FOCUS_EVENT))
      return
    }
    if (location.pathname === '/flow') {
      window.dispatchEvent(new CustomEvent(SUMMON_FOCUS_EVENT))
      return
    }
    const run = getActiveAgentRun()
    const sessionId =
      run?.sessionId ?? getLastAgentSessionId() ?? primaryIntelligenceSessionId()
    const scope =
      run?.contextScope ??
      getLastAgentScope() ??
      (user ? 'personal' : 'work')
    navigate(
      `/flow?session=${encodeURIComponent(sessionId)}&scope=${scope}`
    )
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent(SUMMON_FOCUS_EVENT))
    }, 0)
  }

  async function startNewChat() {
    const binding = isDesktop
      ? await currentProjectBinding().catch(() => null)
      : null
    const scope = binding ? 'work' : user ? 'personal' : 'work'
    const sessionId = crypto.randomUUID().toUpperCase()
    navigate(`/flow?session=${encodeURIComponent(sessionId)}&scope=${scope}`)
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent(SUMMON_FOCUS_EVENT))
    }, 50)
  }

  function clampSidebarChatHeight(height: number): number {
    const sidebar = sidebarRef.current
    const pane = sidebarChatPaneRef.current
    const bottom = sidebar?.querySelector<HTMLElement>(
      '.desktop-sidebar__bottom'
    )
    if (!sidebar || !pane || !bottom) {
      return Math.max(MIN_DESKTOP_SIDEBAR_CHAT_HEIGHT, Math.round(height))
    }
    const sidebarRect = sidebar.getBoundingClientRect()
    const paneRect = pane.getBoundingClientRect()
    const maxHeight = Math.max(
      MIN_DESKTOP_SIDEBAR_CHAT_HEIGHT,
      sidebarRect.bottom -
        paneRect.top -
        bottom.getBoundingClientRect().height -
        84
    )
    return Math.round(
      Math.min(
        maxHeight,
        Math.max(MIN_DESKTOP_SIDEBAR_CHAT_HEIGHT, height)
      )
    )
  }

  function updateSidebarChatHeight(height: number, persist = false) {
    const next = clampSidebarChatHeight(height)
    sidebarChatHeightRef.current = next
    setSidebarChatHeight(next)
    if (persist) {
      localStorage.setItem(DESKTOP_SIDEBAR_CHAT_HEIGHT_KEY, String(next))
    }
  }

  function startSidebarChatResize(
    event: React.PointerEvent<HTMLDivElement>
  ) {
    if (event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    sidebarResizeRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startHeight: sidebarChatPaneRef.current?.getBoundingClientRect().height ??
        sidebarChatHeightRef.current,
    }
    setResizingSidebarChats(true)
  }

  function moveSidebarChatResize(
    event: React.PointerEvent<HTMLDivElement>
  ) {
    const resize = sidebarResizeRef.current
    if (!resize || resize.pointerId !== event.pointerId) return
    updateSidebarChatHeight(
      resize.startHeight + event.clientY - resize.startY
    )
  }

  function finishSidebarChatResize(
    event: React.PointerEvent<HTMLDivElement>
  ) {
    const resize = sidebarResizeRef.current
    if (!resize || resize.pointerId !== event.pointerId) return
    sidebarResizeRef.current = null
    setResizingSidebarChats(false)
    localStorage.setItem(
      DESKTOP_SIDEBAR_CHAT_HEIGHT_KEY,
      String(sidebarChatHeightRef.current)
    )
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  if (isDesktop) {
    return (
      <div className="desktop-shell">
        <DesktopBridge pendingCount={actions.pendingCount} />
        <DesktopOperationGate />
        <RemoteAccessCoordinator />
        <aside
          ref={sidebarRef}
          className={`desktop-sidebar${
            resizingSidebarChats ? ' desktop-sidebar--resizing' : ''
          }`}
        >
          <div className="desktop-sidebar__brand">
            <span className="site-brand__mark" aria-hidden="true" />
            <span>{isFounderBuild ? 'StatsKey Founder' : 'StatsKey'}</span>
          </div>

          <button
            className="desktop-new-chat"
            onClick={() => void startNewChat()}
          >
            <NavIcon name="ask" />
            <span>Ask StatsKey</span>
          </button>

          {hasFounderControls && (
            <nav
              className="desktop-sidebar__nav desktop-sidebar__nav--founder"
              aria-label="Founder operations"
            >
              <DesktopNavLink
                to="/founder"
                label="Founder Console"
                icon="founder"
              />
            </nav>
          )}

          <div
            ref={sidebarChatPaneRef}
            className="desktop-sidebar__chat-pane"
            style={{ height: sidebarChatHeight }}
          >
            <DesktopSidebarChats
              authenticated={user != null}
              uid={user?.uid}
              pathname={location.pathname}
              search={location.search}
              navigate={navigate}
            />
          </div>
          <div
            className="desktop-sidebar__chat-resize"
            role="separator"
            aria-label="Resize conversations list"
            aria-orientation="horizontal"
            aria-valuemin={MIN_DESKTOP_SIDEBAR_CHAT_HEIGHT}
            aria-valuenow={sidebarChatHeight}
            tabIndex={0}
            onPointerDown={startSidebarChatResize}
            onPointerMove={moveSidebarChatResize}
            onPointerUp={finishSidebarChatResize}
            onPointerCancel={finishSidebarChatResize}
            onDoubleClick={() =>
              updateSidebarChatHeight(
                DEFAULT_DESKTOP_SIDEBAR_CHAT_HEIGHT,
                true
              )
            }
            onKeyDown={(event) => {
              if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
              event.preventDefault()
              updateSidebarChatHeight(
                sidebarChatHeightRef.current +
                  (event.key === 'ArrowDown' ? 24 : -24),
                true
              )
            }}
          >
            <span />
          </div>

          <div className="desktop-sidebar__personal-pane">
            <div className="desktop-sidebar__section-label">Personal</div>
            {user ? (
              <>
                <nav
                  className="desktop-sidebar__nav desktop-sidebar__nav--planning"
                  aria-label="Personal planning"
                >
                  {DESKTOP_PLANNING_ITEMS.map((item) => (
                    <DesktopNavLink key={item.to} {...item} />
                  ))}
                </nav>

                <details
                  className="desktop-sidebar__more desktop-sidebar__health"
                  open={isHealthSection || undefined}
                >
                  <summary>
                    <NavIcon name="today" />
                    <span>Health</span>
                  </summary>
                  <nav aria-label="Health sections">
                    {DESKTOP_HEALTH_ITEMS.map((item) => (
                      <DesktopNavLink key={item.to} {...item} />
                    ))}
                  </nav>
                </details>
              </>
            ) : (
              <div
                className="desktop-sidebar-locked"
                role="group"
                aria-label="Personal sections locked until sign in"
              >
                <nav
                  className="desktop-sidebar__nav desktop-sidebar__nav--planning"
                  aria-label="Personal planning"
                >
                  {DESKTOP_PLANNING_ITEMS.filter(
                    (item) => item.to === '/calendar'
                  ).map((item) => (
                    <DesktopNavLink key={item.to} {...item} />
                  ))}
                </nav>
                <button
                  className="desktop-sidebar-locked__unlock"
                  onClick={() => navigate('/login')}
                >
                  <NavIcon name="lock" />
                  <span>Sign in to unlock health &amp; sync</span>
                </button>
                {DESKTOP_PLANNING_ITEMS.filter(
                  (item) => item.to !== '/calendar'
                ).map((item) => (
                  <button
                    key={item.to}
                    className="desktop-sidebar-locked__item"
                    onClick={() => navigate('/login')}
                    title={`Sign in to open ${item.label}`}
                  >
                    <NavIcon name={item.icon} />
                    <span>{item.label}</span>
                    <NavIcon name="lock" />
                  </button>
                ))}
                <button
                  className="desktop-sidebar-locked__item"
                  onClick={() => navigate('/login')}
                  title="Sign in to open Health"
                >
                  <NavIcon name="today" />
                  <span>Health</span>
                  <NavIcon name="lock" />
                </button>
              </div>
            )}

            <details className="desktop-sidebar__more">
              <summary>
                <NavIcon name="more" />
                <span>More</span>
              </summary>
              <nav aria-label="More sections">
                {DESKTOP_MORE_ITEMS.map((item) => (
                  <DesktopNavLink key={item.to} {...item} />
                ))}
              </nav>
            </details>
          </div>

          <div className="desktop-sidebar__bottom">
            <div className="desktop-account-row">
              <NavLink
                to={user ? '/profile' : '/login'}
                className="desktop-account"
              >
                <span className="desktop-account__avatar">
                  {(user?.email?.[0] ?? 'S').toUpperCase()}
                </span>
                <span>
                  <b>{user ? 'Connections & settings' : 'Sign in for sync'}</b>
                  <small>{user?.email ?? 'Local workspace active'}</small>
                </span>
              </NavLink>
              <details className="desktop-account-actions">
                <summary aria-label="Account and app options" title="More options">
                  •••
                </summary>
                <div
                  onClickCapture={(event) =>
                    event.currentTarget
                      .closest('details')
                      ?.removeAttribute('open')
                  }
                >
                  <button
                    className="desktop-update-check"
                    onClick={() => void checkForDesktopUpdates()}
                  >
                    Check for updates
                  </button>
                  <button
                    className="desktop-update-check"
                    onClick={() =>
                      void getDesktopBridge()?.openExternal(
                        'https://statskey.ai/downloads/statskey/#updates'
                      )
                    }
                  >
                    What’s new
                  </button>
                  {user ? (
                    <button className="desktop-signout" onClick={handleSignOut}>
                      Sign out
                    </button>
                  ) : (
                    <button
                      className="desktop-signout"
                      onClick={() => navigate('/login')}
                    >
                      Sign in
                    </button>
                  )}
                </div>
              </details>
            </div>
          </div>
        </aside>

        <section className="desktop-stage">
          <RemoteAccessOnboardingPrompt />
          <header className="desktop-titlebar">
            <div className="desktop-titlebar__context">
              {!['/flow', '/workspace'].includes(location.pathname) && (
                <span className="desktop-titlebar__route">
                  {desktopRouteTitle(location.pathname)}
                </span>
              )}
              <DesktopWorkspaceIdentity
                pathname={location.pathname}
                navigate={navigate}
              />
            </div>
            <div>
              {actions.pendingCount > 0 && (
                <button className="desktop-review-button" onClick={openAssistant}>
                  Review {actions.pendingCount}
                </button>
              )}
              {location.pathname !== '/flow' && (
                <button className="desktop-ask-button" onClick={openAssistant}>
                  <NavIcon name="ask" />
                  <span>Intelligence</span>
                  <kbd>⌘⇧Space</kbd>
                </button>
              )}
            </div>
          </header>
          <DesktopSurfaceBar
            pathname={location.pathname}
            search={location.search}
            navigate={navigate}
            authenticated={user != null}
            uid={user?.uid}
          />
          <main
            className={`desktop-main${isWorkbench ? ' desktop-main--workbench' : ''}`}
          >
            <Outlet />
          </main>
        </section>
      </div>
    )
  }

  return (
    <div className="app-shell">
      <DesktopBridge pendingCount={actions.pendingCount} />
      <nav className="app-nav">
        <div className="max-w-[1080px] mx-auto px-4 sm:px-6 h-12 flex items-center justify-between gap-3">
          <div className="flex items-center gap-6 min-w-0">
            {isDesktop ? (
              <NavLink to="/" className="app-brand">
                <span className="site-brand__mark" aria-hidden="true" />
                <span>StatsKey</span>
              </NavLink>
            ) : (
              <a href="/" className="app-brand">
                <span className="site-brand__mark" aria-hidden="true" />
                <span>StatsKey</span>
              </a>
            )}
            {/* Desktop: inline links, unchanged look */}
            <div className="hidden md:flex flex-wrap items-center gap-x-5 gap-y-1 text-[13px] text-text-muted">
              {NAV_ITEMS.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    isActive ? 'text-text-primary' : 'hover:text-text-primary transition-colors'
                  }
                >
                  {item.label}
                </NavLink>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-4 text-[12px] text-text-muted shrink-0">
            <span className="hidden sm:inline">{user?.email}</span>
            <button className="btn btn-ghost" onClick={handleSignOut}>Sign out</button>
          </div>
        </div>
        {/* Mobile: swipeable pill strip with comfortable tap targets */}
        <div ref={stripRef} className="app-nav-strip md:hidden" role="navigation" aria-label="Sections">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => `app-nav-pill${isActive ? ' active' : ''}`}
            >
              {item.label}
            </NavLink>
          ))}
        </div>
      </nav>
      <main
        className={`app-main mx-auto px-4 sm:px-6 py-6 sm:py-8 ${
          isWorkbench ? 'max-w-[1600px]' : 'max-w-[1080px]'
        }`}
      >
        <Outlet />
      </main>
    </div>
  )
}

function DesktopWorkspaceIdentity({
  pathname,
  navigate,
}: {
  pathname: string
  navigate: (to: string) => void
}) {
  const bridge = getDesktopBridge()
  const [workspace, setWorkspace] = useState<DesktopWorkspaceState | null>(
    null
  )
  const [recents, setRecents] = useState<DesktopRecentProject[]>([])
  const [identityOpen, setIdentityOpen] = useState(false)
  const identityRef = useRef<HTMLDetailsElement>(null)

  useEffect(() => {
    if (!bridge) return
    let active = true
    const refresh = async (next?: DesktopWorkspaceState) => {
      const [state, recentProjects] = await Promise.all([
        next ? Promise.resolve(next) : bridge.workspace.getState(),
        bridge.workspace.recentProjects(),
      ])
      if (!active) return
      setWorkspace(state)
      setRecents(recentProjects)
    }
    void refresh()
    const unsubscribe = bridge.workspace.onState((state) => {
      void refresh(state)
    })
    const onFocus = () => void refresh()
    window.addEventListener('focus', onFocus)
    return () => {
      active = false
      unsubscribe()
      window.removeEventListener('focus', onFocus)
    }
  }, [bridge, pathname])

  useEffect(() => {
    if (!identityOpen) return
    const closeOutside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !identityRef.current?.contains(event.target)
      ) {
        setIdentityOpen(false)
      }
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setIdentityOpen(false)
      identityRef.current?.querySelector<HTMLElement>('summary')?.focus()
    }
    document.addEventListener('pointerdown', closeOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [identityOpen])

  const binding = workspace
    ? projectBindingForWorkspace(workspace, recents)
    : null
  const recent = binding
    ? recents.find((project) => project.id === binding.id) ??
      recents.find((project) => sameProjectRoots(project.roots, binding.roots))
    : undefined
  const rootCount = workspace?.roots.length ?? 0

  async function saveWorkspace() {
    if (!bridge || !binding) return
    const name = await promptDialog({
      title: 'Save workspace',
      body: 'The name appears in the sidebar and in recent workspaces.',
      label: 'Workspace name',
      initialValue: binding.label,
      confirmLabel: 'Save',
    })
    if (!name?.trim()) return
    const result = await bridge.workspace.saveWorkspace(name.trim())
    if (!result.ok) {
      showToast(result.error || 'The workspace could not be saved.', {
        kind: 'error',
      })
    }
  }

  function chooseWorkspace() {
    requestWorkspaceQuickTool('open-project')
    if (pathname !== '/workspace') navigate('/workspace')
  }

  return (
    <details
      ref={identityRef}
      className="desktop-workspace-identity"
      open={identityOpen}
      onToggle={(event) => setIdentityOpen(event.currentTarget.open)}
    >
      <summary
        title={
          binding
            ? `Workspace: ${binding.label}\n${binding.roots.join('\n')}`
            : 'No file workspace is open'
        }
      >
        <NavIcon name="workspace" />
        <span>
          <small>{binding ? 'Workspace' : 'Context'}</small>
          <b>{binding?.label ?? 'Personal only'}</b>
        </span>
        {binding && (
          <i className={recent?.saved ? 'saved' : ''}>
            {rootCount} {rootCount === 1 ? 'folder' : 'folders'}
          </i>
        )}
        <em aria-hidden="true">⌄</em>
      </summary>
      <div className="desktop-workspace-identity__popover">
        <header>
          <div>
            <small>Active workspace</small>
            <strong>{binding?.label ?? 'No workspace open'}</strong>
          </div>
          {binding && <span>{recent?.saved ? 'Saved' : 'Not saved'}</span>}
        </header>
        <p>
          {binding
            ? 'This named folder set defines the files, terminal, Git state, and default context available to its work chats.'
            : 'Personal chats use your connected StatsKey context. Open a workspace to give work chats a defined set of local folders.'}
        </p>
        {workspace && workspace.roots.length > 0 && (
          <ul>
            {workspace.roots.map((root) => (
              <li key={root.path}>
                <NavIcon name="workspace" />
                <span>
                  <b>{root.name}</b>
                  <code>{root.path}</code>
                </span>
              </li>
            ))}
          </ul>
        )}
        <footer>
          <button
            onClick={() => {
              requestWorkspaceQuickTool('explorer')
              setIdentityOpen(false)
              if (pathname !== '/workspace') navigate('/workspace')
            }}
            disabled={!binding}
          >
            Open files
          </button>
          {binding && !recent?.saved && (
            <button onClick={() => void saveWorkspace()}>Save name</button>
          )}
          <button
            className="primary"
            onClick={() => {
              setIdentityOpen(false)
              chooseWorkspace()
            }}
          >
            {binding ? 'Switch…' : 'Open workspace…'}
          </button>
        </footer>
      </div>
    </details>
  )
}

function DesktopSurfaceBar({
  pathname,
  search,
  navigate,
  authenticated,
  uid,
}: {
  pathname: string
  search: string
  navigate: (to: string) => void
  authenticated: boolean
  uid: string | undefined
}) {
  const [openIds, setOpenIds] = useState<DesktopSurfaceId[]>(
    loadDesktopSurfaceTabs
  )
  const navigationType = useNavigationType()
  const [closedChatTabIds, setClosedChatTabIds] = useState(
    loadClosedDesktopChatTabIds
  )
  const [menuOpen, setMenuOpen] = useState(false)
  const tabMenuRef = useRef<HTMLDivElement>(null)
  const tabMenuTriggerRef = useRef<HTMLButtonElement>(null)
  const [draggedId, setDraggedId] = useState<DesktopSurfaceId | null>(null)
  const [chatTabs, setChatTabs] = useState<DesktopChatTab[]>(() => {
    const closed = new Set(loadClosedDesktopChatTabIds())
    return loadDesktopChatTabs().filter((tab) => !closed.has(tab.sessionId))
  })
  const [draggedChatId, setDraggedChatId] = useState<string | null>(null)
  const pendingChatClosuresRef = useRef(new Set<string>())
  const previousRequestedSessionRef = useRef<string | null>(null)
  const [addingChatTab, setAddingChatTab] = useState(false)
  const [activityOpen, setActivityOpen] = useState(false)
  const [inspectedActivity, setInspectedActivity] = useState<{
    sessionId: string
    stepId: string
  } | null>(null)
  const [activityClock, setActivityClock] = useState(Date.now())
  const [activeRuns, setActiveRuns] = useState<ActiveAgentRun[]>(
    getActiveAgentRuns
  )
  const local = useRecentLocalChatSessions(80)
  const cloud = useRecentChatSessions(uid, 40)
  const sessions = useMemo(
    () =>
      mergeChatSessions(local.sessions, cloud.sessions, 150).filter(
        (session) => session.archivedAt == null
      ),
    [local.sessions, cloud.sessions]
  )
  const requestedSessionId =
    pathname === '/flow' ? new URLSearchParams(search).get('session') : null
  const requestedScope: 'work' | 'personal' =
    new URLSearchParams(search).get('scope') === 'work' ? 'work' : 'personal'
  const activeChatTab = requestedSessionId
    ? chatTabs.find((tab) => tab.sessionId === requestedSessionId) ?? null
    : null
  const activeId = activeChatTab
    ? null
    : desktopSurfaceForPath(pathname)?.id ?? null
  const inspectedRun = inspectedActivity
    ? activeRuns.find((run) => run.sessionId === inspectedActivity.sessionId)
    : undefined
  const inspectedStep = inspectedRun?.recentSteps?.find(
    (step) => step.id === inspectedActivity?.stepId
  )

  useEffect(() => {
    const refresh = () => {
      const runs = getActiveAgentRuns()
      setActiveRuns(runs)
      if (runs.length === 0) {
        setActivityOpen(false)
        setInspectedActivity(null)
      }
    }
    window.addEventListener(AGENT_RUN_STATE_EVENT, refresh)
    const timer = window.setInterval(() => setActivityClock(Date.now()), 1_000)
    return () => {
      window.removeEventListener(AGENT_RUN_STATE_EVENT, refresh)
      window.clearInterval(timer)
    }
  }, [])

  useEffect(() => {
    if (!inspectedActivity) return
    if (!inspectedRun || !inspectedStep) setInspectedActivity(null)
  }, [inspectedActivity, inspectedRun, inspectedStep])

  useEffect(() => {
    const bridge = getDesktopBridge()
    if (!bridge?.browser?.onState) return
    return bridge.browser.onState((state) => {
      if (state.tabs.length === 0) return
      setOpenIds((current) =>
        current.includes('browser') ? current : [...current, 'browser']
      )
    })
  }, [])

  useEffect(() => {
    if (!menuOpen) return
    const closeOutside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !tabMenuRef.current?.contains(event.target)
      ) {
        setMenuOpen(false)
      }
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setMenuOpen(false)
      tabMenuTriggerRef.current?.focus()
    }
    document.addEventListener('pointerdown', closeOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [menuOpen])

  // Explicit navigation opens one requested conversation. Browser history may
  // display a previously closed conversation, but it must not resurrect its tab.
  useEffect(() => {
    if (previousRequestedSessionRef.current !== requestedSessionId) {
      if (requestedSessionId) {
        pendingChatClosuresRef.current.delete(requestedSessionId)
      }
      previousRequestedSessionRef.current = requestedSessionId
    }
    if (!requestedSessionId) return
    if (
      !shouldOpenRequestedDesktopChatTab(
        requestedSessionId,
        navigationType,
        closedChatTabIds,
        [...pendingChatClosuresRef.current]
      )
    ) {
      return
    }
    setClosedChatTabIds((current) =>
      withoutClosedDesktopChatTab(current, requestedSessionId)
    )
    setChatTabs((current) =>
      current.some((tab) => tab.sessionId === requestedSessionId)
        ? current
        : [
            ...current,
            { sessionId: requestedSessionId, scope: requestedScope },
          ].slice(-MAX_DESKTOP_CHAT_TABS)
    )
  }, [closedChatTabIds, navigationType, requestedSessionId, requestedScope])

  useEffect(() => {
    if (!activeId) return
    setOpenIds((current) =>
      current.includes(activeId) ? current : [...current, activeId]
    )
  }, [activeId])

  useEffect(() => {
    localStorage.setItem(
      DESKTOP_SURFACE_STORAGE_KEY,
      JSON.stringify(openIds)
    )
  }, [openIds])

  useEffect(() => {
    localStorage.setItem(DESKTOP_CHAT_TABS_KEY, JSON.stringify(chatTabs))
  }, [chatTabs])

  useEffect(() => {
    localStorage.setItem(
      DESKTOP_CLOSED_CHAT_TABS_KEY,
      JSON.stringify(closedChatTabIds)
    )
  }, [closedChatTabIds])

  useEffect(() => {
    const onLifecycle = (event: Event) => {
      const sessionId = (event as CustomEvent<{ sessionId?: unknown }>).detail
        ?.sessionId
      if (typeof sessionId !== 'string') return
      setClosedChatTabIds((current) =>
        withClosedDesktopChatTab(current, sessionId)
      )
      setChatTabs((current) =>
        current.filter((tab) => tab.sessionId !== sessionId)
      )
    }
    window.addEventListener(CHAT_SESSION_LIFECYCLE_EVENT, onLifecycle)
    return () =>
      window.removeEventListener(CHAT_SESSION_LIFECYCLE_EVENT, onLifecycle)
  }, [])

  // One shell-level keydown listener: Cmd+1…9 activates the Nth tab in the
  // visual strip order (surfaces, then chats); Ctrl+Tab / Ctrl+Shift+Tab
  // cycle through them. On /workspace both groups belong to the Workspace
  // editor (Cmd+digit tab jumps, Ctrl+Tab MRU cycling), so they are left
  // untouched there.
  useEffect(() => {
    const surfaceTabs = openIds.flatMap((id) => {
      const surface = DESKTOP_SURFACES.find((candidate) => candidate.id === id)
      return surface ? [surface] : []
    })
    const total = surfaceTabs.length + chatTabs.length
    const activateTab = (index: number) => {
      if (index < 0 || index >= total) return
      if (index < surfaceTabs.length) {
        navigate(surfaceTabs[index].to)
        return
      }
      const tab = chatTabs[index - surfaceTabs.length]
      if (tab) void openChatTab(tab)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      const target = event.target
      if (
        target instanceof HTMLElement &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return
      }
      if (
        (event.metaKey || event.ctrlKey) &&
        !event.shiftKey &&
        !event.altKey &&
        /^[1-9]$/.test(event.key)
      ) {
        if (pathname.startsWith('/workspace')) return
        const index = Number(event.key) - 1
        if (index >= total) return
        event.preventDefault()
        activateTab(index)
        return
      }
      if (
        event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        event.key === 'Tab'
      ) {
        if (pathname.startsWith('/workspace')) return
        if (total === 0) return
        event.preventDefault()
        const current = activeChatTab
          ? surfaceTabs.length +
            chatTabs.findIndex(
              (tab) => tab.sessionId === activeChatTab.sessionId
            )
          : activeId
            ? surfaceTabs.findIndex((surface) => surface.id === activeId)
            : -1
        const next =
          current < 0
            ? event.shiftKey
              ? total - 1
              : 0
            : (current + (event.shiftKey ? -1 : 1) + total) % total
        activateTab(next)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
    // openChatTab reads chatTabs and sessions, both dependencies here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openIds, chatTabs, pathname, activeId, activeChatTab, sessions])

  // The application menu's Close Tab command lands here when the Workspace
  // surface is not focused; close the active conversation tab or surface.
  useEffect(() => {
    const onCloseActiveTab = () => {
      if (activeChatTab) {
        closeChatTab(activeChatTab.sessionId)
        return
      }
      if (activeId) closeSurface(activeId)
    }
    // GitHubCloudWorkspace dispatches this after the user confirms discarding
    // dirty drafts; the github surface then closes unconditionally.
    const onCloseTabConfirmed = () => closeSurface('github')
    window.addEventListener(MENU_CLOSE_ACTIVE_TAB_EVENT, onCloseActiveTab)
    window.addEventListener(MENU_CLOSE_TAB_CONFIRMED_EVENT, onCloseTabConfirmed)
    return () => {
      window.removeEventListener(MENU_CLOSE_ACTIVE_TAB_EVENT, onCloseActiveTab)
      window.removeEventListener(
        MENU_CLOSE_TAB_CONFIRMED_EVENT,
        onCloseTabConfirmed
      )
    }
    // closeChatTab/closeSurface read chatTabs and openIds, dependencies here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeChatTab, activeId, chatTabs, openIds, sessions])

  function openSurface(id: DesktopSurfaceId) {
    const surface = DESKTOP_SURFACES.find((candidate) => candidate.id === id)
    if (!surface) return
    setOpenIds((current) =>
      current.includes(id) ? current : [...current, id]
    )
    setMenuOpen(false)
    navigate(surface.to)
  }

  function closeSurface(id: DesktopSurfaceId) {
    const index = openIds.indexOf(id)
    const remaining = openIds.filter((candidate) => candidate !== id)
    setOpenIds(remaining)
    if (activeId !== id) return
    const fallbackId =
      remaining[Math.min(Math.max(0, index), remaining.length - 1)] ?? null
    const fallback = DESKTOP_SURFACES.find(
      (candidate) => candidate.id === fallbackId
    )
    navigate(
      fallback
        ? fallback.to
        : desktopNeutralChatRoute(authenticated ? 'personal' : 'work')
    )
  }

  function reorderSurface(
    sourceId: DesktopSurfaceId,
    targetId: DesktopSurfaceId
  ) {
    setOpenIds((current) => {
      const source = current.indexOf(sourceId)
      const target = current.indexOf(targetId)
      if (source < 0 || target < 0 || source === target) return current
      const next = [...current]
      const [moved] = next.splice(source, 1)
      next.splice(target, 0, moved)
      return next
    })
  }

  function openWorkspaceTool(tool: WorkspaceQuickTool) {
    requestWorkspaceQuickTool(tool)
    if (pathname !== '/workspace') navigate('/workspace')
  }

  async function addChatTab() {
    if (addingChatTab || chatTabs.length >= MAX_DESKTOP_CHAT_TABS) return
    setAddingChatTab(true)
    try {
      const binding = await currentProjectBinding().catch(() => null)
      const scope: 'work' | 'personal' = binding
        ? 'work'
        : authenticated
          ? 'personal'
          : 'work'
      const sessionId = crypto.randomUUID().toUpperCase()
      setChatTabs((current) =>
        [...current, { sessionId, scope }].slice(-MAX_DESKTOP_CHAT_TABS)
      )
      navigate(
        `/flow?session=${encodeURIComponent(sessionId)}&scope=${scope}`
      )
      window.setTimeout(() => {
        window.dispatchEvent(new CustomEvent(SUMMON_FOCUS_EVENT))
      }, 50)
    } finally {
      setAddingChatTab(false)
    }
  }

  async function openChatTab(tab: DesktopChatTab) {
    if (tab.scope === 'work') {
      const session =
        sessions.find((candidate) => candidate.id === tab.sessionId) ??
        (await loadLocalChatSession(tab.sessionId))
      if (session) {
        const opened = await ensureDesktopProjectOpen(session)
        if (!opened.ok) {
          showToast(opened.error, { kind: 'error' })
          return
        }
      }
    }
    setClosedChatTabIds((current) =>
      withoutClosedDesktopChatTab(current, tab.sessionId)
    )
    navigate(
      `/flow?session=${encodeURIComponent(tab.sessionId)}&scope=${tab.scope}`
    )
  }

  async function forkChatTab(tab: DesktopChatTab) {
    if (chatTabs.length >= MAX_DESKTOP_CHAT_TABS) {
      showToast('Close a conversation tab before forking another one.', {
        kind: 'error',
      })
      return
    }
    const source =
      sessions.find((candidate) => candidate.id === tab.sessionId) ??
      (await loadLocalChatSession(tab.sessionId))
    const sourceState = await loadAgentLocalState(tab.sessionId)
    const now = new Date()
    const forkId = crypto.randomUUID().toUpperCase()
    const run = activeRuns.find(
      (candidate) => candidate.sessionId === tab.sessionId
    )
    const forkTitle = `Fork: ${source?.title || run?.title || 'Conversation'}`
    let forkMessages = source?.messages.map((message) => ({ ...message })) ?? []
    if (source) {
      try {
        const forked = await forkChatPlanCanvases({
          messages: source.messages,
          forkSessionId: forkId,
          scope: tab.scope,
          binding: workspaceBindingForSession(source),
          now,
        })
        forkMessages = forked.messages
      } catch (forkError) {
        showToast(
          forkError instanceof Error
            ? forkError.message
            : 'The planning canvases could not be copied safely, so the fork was not opened.',
          { kind: 'error' }
        )
        return
      }
    }
    const forkSession: ChatSession = {
      id: forkId,
      title: forkTitle,
      messages: forkMessages,
      mode: 'general',
      contextScope: tab.scope,
      projectId: source?.projectId,
      projectLabel: source?.projectLabel,
      projectRoots: source?.projectRoots,
      parentSessionId: tab.sessionId,
      createdAt: now,
      updatedAt: now,
    }
    await Promise.all([
      saveLocalChatSession(forkSession),
      saveAgentLocalState(forkId, {
        draft: sourceState.draft,
        chatAttachments: sourceState.chatAttachments,
        queuedPrompts: [],
      }),
    ])
    const forkTab = { sessionId: forkId, scope: tab.scope }
    setChatTabs((current) =>
      [...current, forkTab].slice(-MAX_DESKTOP_CHAT_TABS)
    )
    setActivityOpen(false)
    await openChatTab(forkTab)
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent(SUMMON_FOCUS_EVENT))
    }, 50)
  }

  function closeChatTab(sessionId: string) {
    const index = chatTabs.findIndex((tab) => tab.sessionId === sessionId)
    if (index < 0) return
    const remaining = chatTabs.filter((tab) => tab.sessionId !== sessionId)
    pendingChatClosuresRef.current.add(sessionId)
    setClosedChatTabIds((current) =>
      persistClosedChatTabIds(withClosedDesktopChatTab(current, sessionId))
    )
    localStorage.setItem(DESKTOP_CHAT_TABS_KEY, JSON.stringify(remaining))
    setChatTabs(remaining)
    if (activeChatTab?.sessionId !== sessionId) return
    const fallback =
      remaining[Math.min(index, remaining.length - 1)] ?? null
    if (fallback) {
      void openChatTab(fallback)
      return
    }
    const surface = DESKTOP_SURFACES.find((candidate) =>
      openIds.includes(candidate.id)
    )
    navigate(
      surface
        ? surface.to
        : desktopNeutralChatRoute(authenticated ? 'personal' : 'work')
    )
  }

  function reorderChatTab(sourceId: string, targetId: string) {
    setChatTabs((current) => {
      const source = current.findIndex((tab) => tab.sessionId === sourceId)
      const target = current.findIndex((tab) => tab.sessionId === targetId)
      if (source < 0 || target < 0 || source === target) return current
      const next = [...current]
      const [moved] = next.splice(source, 1)
      next.splice(target, 0, moved)
      return next
    })
  }

  function chatTabTitle(tab: DesktopChatTab): string {
    const session = sessions.find(
      (candidate) => candidate.id === tab.sessionId
    )
    if (session?.title) return session.title
    const run = activeRuns.find(
      (candidate) => candidate.sessionId === tab.sessionId
    )
    return run?.title ?? 'New chat'
  }

  const closedSurfaces = DESKTOP_SURFACES.filter(
    (surface) => !openIds.includes(surface.id)
  )
  const openTabEntries = desktopOpenTabMenuEntries({
    surfaces: openIds.flatMap((id) => {
      const surface = DESKTOP_SURFACES.find((candidate) => candidate.id === id)
      return surface ? [{ id: surface.id, label: surface.label }] : []
    }),
    chats: chatTabs.map((tab) => ({
      sessionId: tab.sessionId,
      label: chatTabTitle(tab),
      running: activeRuns.some((run) => run.sessionId === tab.sessionId),
    })),
    activeSurfaceId: activeId,
    activeChatSessionId: activeChatTab?.sessionId ?? null,
  })
  const oldChatTabIds = safeOldDesktopChatTabIds({
    tabs: chatTabs,
    sessions,
    activeSessionId: activeChatTab?.sessionId ?? null,
    runningSessionIds: activeRuns.map((run) => run.sessionId),
  })
  const otherChatTabIds = safeOtherDesktopChatTabIds({
    tabs: chatTabs,
    savedSessionIds: sessions.map((session) => session.id),
    activeSessionId: activeChatTab?.sessionId ?? null,
    runningSessionIds: activeRuns.map((run) => run.sessionId),
  })

  async function closeTaskTabs(
    closingIds: readonly string[],
    title: string,
    body: string
  ) {
    if (closingIds.length === 0) return
    const confirmed = await confirmDialog({
      title,
      body,
      confirmLabel: closingIds.length === 1 ? 'Close tab' : 'Close tabs',
    })
    if (!confirmed) return
    const closing = new Set(closingIds)
    closingIds.forEach((sessionId) =>
      pendingChatClosuresRef.current.add(sessionId)
    )
    setClosedChatTabIds((current) =>
      persistClosedChatTabIds(
        closingIds.reduce(withClosedDesktopChatTab, current)
      )
    )
    const remaining = chatTabs.filter(
      (tab) => !closing.has(tab.sessionId)
    )
    localStorage.setItem(DESKTOP_CHAT_TABS_KEY, JSON.stringify(remaining))
    setChatTabs(remaining)
    setMenuOpen(false)
  }

  return (
    <div className="desktop-surface-bar">
      <nav aria-label="Open desktop surfaces">
        {openIds.flatMap((id) => {
          const surface = DESKTOP_SURFACES.find(
            (candidate) => candidate.id === id
          )
          if (!surface) return []
          const active = activeId === id
          return [
            <div
              key={id}
              className={[
                'desktop-surface-tab',
                active ? 'active' : '',
                draggedId === id ? 'dragging' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              draggable
              onDragStart={(event) => {
                setDraggedId(id)
                event.dataTransfer.effectAllowed = 'move'
              }}
              onDragEnd={() => setDraggedId(null)}
              onDragOver={(event) => {
                if (draggedId && draggedId !== id) event.preventDefault()
              }}
              onDrop={(event) => {
                event.preventDefault()
                if (draggedId) reorderSurface(draggedId, id)
                setDraggedId(null)
              }}
              onAuxClick={(event) => {
                if (event.button !== 1) return
                event.preventDefault()
                closeSurface(id)
              }}
            >
              <button
                className="desktop-surface-tab__open"
                onClick={() => navigate(surface.to)}
                aria-current={active ? 'page' : undefined}
                title={surface.label}
              >
                <NavIcon name={surface.icon} />
                <span>{surface.label}</span>
              </button>
              <button
                className="desktop-surface-tab__close"
                onClick={() => closeSurface(id)}
                aria-label={`Close ${surface.label} tab`}
                title={`Close ${surface.label}`}
              >
                ×
              </button>
            </div>,
          ]
        })}
        {chatTabs.map((tab) => {
          const run = activeRuns.find(
            (run) => run.sessionId === tab.sessionId
          )
          const running = run != null
          const active = activeChatTab?.sessionId === tab.sessionId
          const title = chatTabTitle(tab)
          const session = sessions.find(
            (candidate) => candidate.id === tab.sessionId
          )
          return (
            <div
              key={tab.sessionId}
              className={[
                'desktop-surface-tab',
                'desktop-surface-tab--agent',
                active ? 'active' : '',
                draggedChatId === tab.sessionId ? 'dragging' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              draggable
              onDragStart={(event) => {
                setDraggedChatId(tab.sessionId)
                event.dataTransfer.effectAllowed = 'move'
              }}
              onDragEnd={() => setDraggedChatId(null)}
              onDragOver={(event) => {
                if (draggedChatId && draggedChatId !== tab.sessionId) {
                  event.preventDefault()
                }
              }}
              onDrop={(event) => {
                event.preventDefault()
                if (draggedChatId) {
                  reorderChatTab(draggedChatId, tab.sessionId)
                }
                setDraggedChatId(null)
              }}
              onAuxClick={(event) => {
                if (event.button !== 1) return
                event.preventDefault()
                closeChatTab(tab.sessionId)
              }}
            >
              <button
                className="desktop-surface-tab__open"
                onClick={() => void openChatTab(tab)}
                aria-current={active ? 'page' : undefined}
                title={[title, session?.projectLabel]
                  .filter(Boolean)
                  .join(' · ')}
              >
                <NavIcon name="ask" />
                <span>{title}</span>
                {running && (
                  <i className="desktop-surface-tab__running">
                    {runTabStatus(run)}
                  </i>
                )}
              </button>
              <button
                className="desktop-surface-tab__fork"
                onClick={() => void forkChatTab(tab)}
                aria-label={`Fork conversation tab ${title}`}
                title={
                  chatTabs.length >= MAX_DESKTOP_CHAT_TABS
                    ? 'Close a conversation tab before forking'
                    : running
                      ? 'Fork this running tab'
                      : 'Fork this tab'
                }
                disabled={chatTabs.length >= MAX_DESKTOP_CHAT_TABS}
              >
                ⑂
              </button>
              <button
                className="desktop-surface-tab__close"
                onClick={() => closeChatTab(tab.sessionId)}
                aria-label={`Close conversation tab ${title}`}
                title="Close tab (the conversation keeps running and stays in the sidebar)"
              >
                ×
              </button>
            </div>
          )
        })}
      </nav>
      <div className="desktop-run-center">
        {activeRuns.length > 0 && (
          <button
            className="is-active"
            onClick={() =>
              setActivityOpen((current) => {
                if (current) setInspectedActivity(null)
                return !current
              })
            }
            aria-expanded={activityOpen}
            aria-label={`${activeRuns.length} active Intelligence ${
              activeRuns.length === 1 ? 'run' : 'runs'
            }`}
            title="Preview every Intelligence run"
          >
            <span className="intel-dot intel-dot--running" />
            <span>Working</span>
            <b>{activeRuns.length}</b>
          </button>
        )}
        {activityOpen && activeRuns.length > 0 && (
          <section className="desktop-run-center__panel" aria-label="Intelligence activity center">
            <header>
              <div>
                <b>What Intelligence is doing</b>
                <span>Plain-language progress across your open conversations.</span>
              </div>
              <button
                onClick={() => {
                  setInspectedActivity(null)
                  setActivityOpen(false)
                }}
                aria-label="Close activity center"
              >
                ×
              </button>
            </header>
            {activeRuns.length === 0 ? (
              <p className="desktop-run-center__empty">No Intelligence runs are active.</p>
            ) : (
              <div className="desktop-run-center__runs">
                {activeRuns.map((run) => {
                  const tab: DesktopChatTab = {
                    sessionId: run.sessionId,
                    scope: run.contextScope,
                  }
                  const quietFor = Math.max(
                    0,
                    activityClock - (run.lastActivityAt ?? run.startedAt)
                  )
                  const previewStep = [...(run.recentSteps ?? [])]
                    .reverse()
                    .find(
                      (step) =>
                        step.preview != null && step.name !== 'investigation'
                    )
                  const researchSummary = activeRunResearchSummary(
                    run.recentSteps ?? []
                  )
                  return (
                    <article key={run.sessionId} data-phase={run.phase ?? 'working'}>
                      <div className="desktop-run-center__run-head">
                        <span className="intel-dot intel-dot--running" />
                        <div>
                          <b>{run.title}</b>
                          <span>{runActivityLabel(run)}</span>
                        </div>
                        <time>{formatRunElapsed(activityClock - run.startedAt)}</time>
                      </div>
                      <p>{run.currentAction || 'Waiting for the next activity update'}</p>
                      {researchSummary && (
                        <div className="desktop-run-center__research-summary">
                          <span>Research</span>
                          <p>{researchSummary}</p>
                        </div>
                      )}
                      {run.liveUpdate && (
                        <div className="desktop-run-center__commentary">
                          <small>Latest update</small>
                          <p>{run.liveUpdate}</p>
                        </div>
                      )}
                      <details className="desktop-run-center__details">
                        <summary>Show detailed activity</summary>
                        <div className="desktop-run-center__meter">
                          <span>
                            {run.completedSteps ?? 0}/{run.totalSteps ?? 0} actions
                          </span>
                          <span>{orchestrationRunLabel(run.orchestrationMode)}</span>
                          {run.agentMode && (
                            <span>{agentModeLabel(run.agentMode)} mode</span>
                          )}
                          {run.modelLabel && <span>{run.modelLabel}</span>}
                          {run.providerRound && <span>cycle {run.providerRound}</span>}
                          {run.providerQueuePosition && (
                            <span>queue #{run.providerQueuePosition}</span>
                          )}
                          {run.phase === 'responding' &&
                            typeof run.outputCharacters === 'number' && (
                              <span>{run.outputCharacters.toLocaleString()} chars</span>
                            )}
                          {quietFor >= 15_000 && (
                            <span>No update for {formatRunElapsed(quietFor)}</span>
                          )}
                        </div>
                        {run.recentSteps && run.recentSteps.length > 0 && (
                          <ol>
                            {run.recentSteps.slice(-6).map((step) => (
                              <li key={step.id} data-status={step.status}>
                                <div>
                                  <b>{step.agent || 'Intelligence'}</b>
                                  <span>{step.label}</span>
                                  {step.summary && step.summary !== step.label && (
                                    <code>{step.summary}</code>
                                  )}
                                </div>
                                <small>
                                  {step.resultMeta || step.status}
                                  {typeof step.ms === 'number'
                                    ? ` · ${formatRunElapsed(step.ms)}`
                                    : ''}
                                </small>
                                {step.name === 'investigation' && step.preview && (
                                  <button
                                    type="button"
                                    className="desktop-run-center__inspect"
                                    onClick={() =>
                                      setInspectedActivity({
                                        sessionId: run.sessionId,
                                        stepId: step.id,
                                      })
                                    }
                                  >
                                    {step.status === 'running'
                                      ? 'Open brief'
                                      : 'Open summary'}
                                  </button>
                                )}
                              </li>
                            ))}
                          </ol>
                        )}
                        {previewStep?.preview && (
                          <RunActivityPreview preview={previewStep.preview} />
                        )}
                      </details>
                      <footer>
                        <button
                          onClick={() => {
                            setActivityOpen(false)
                            void openChatTab(tab)
                          }}
                        >
                          Open
                        </button>
                        <button
                          disabled={chatTabs.length >= MAX_DESKTOP_CHAT_TABS}
                          onClick={() => void forkChatTab(tab)}
                        >
                          Make a copy
                        </button>
                        <button
                          className="danger"
                          disabled={!hasActiveAgentRunControl(run.sessionId)}
                          onClick={() => requestActiveAgentRunStop(run.sessionId)}
                        >
                          {run.phase === 'stopping' ? 'Stopping…' : 'Stop'}
                        </button>
                      </footer>
                    </article>
                  )
                })}
              </div>
            )}
            {inspectedRun && inspectedStep && (
              <InvestigationInspector
                run={inspectedRun}
                step={inspectedStep}
                onBack={() => setInspectedActivity(null)}
                onOpenConversation={() => {
                  setInspectedActivity(null)
                  setActivityOpen(false)
                  void openChatTab({
                    sessionId: inspectedRun.sessionId,
                    scope: inspectedRun.contextScope,
                  })
                }}
                onFollowUp={() => {
                  const prompt = investigationFollowUpPrompt(inspectedStep)
                  setInspectedActivity(null)
                  setActivityOpen(false)
                  void openChatTab({
                    sessionId: inspectedRun.sessionId,
                    scope: inspectedRun.contextScope,
                  }).then(() => {
                    window.setTimeout(() => {
                      window.dispatchEvent(
                        new CustomEvent(AGENT_PREFILL_EVENT, {
                          detail: { text: prompt },
                        })
                      )
                    }, 0)
                  })
                }}
              />
            )}
          </section>
        )}
      </div>
      <div className="desktop-surface-add" ref={tabMenuRef}>
        <button
          className="desktop-surface-add__new"
          onClick={() => void addChatTab()}
          aria-label="New Intelligence tab"
          title={
            chatTabs.length >= MAX_DESKTOP_CHAT_TABS
              ? 'Tab limit reached — close a tab first'
              : 'New Intelligence tab'
          }
          disabled={
            addingChatTab || chatTabs.length >= MAX_DESKTOP_CHAT_TABS
          }
        >
          +
        </button>
        {openTabEntries.length > 1 && (
          <button
            ref={tabMenuTriggerRef}
            className="desktop-surface-add__tabs"
            onClick={() => {
              setActivityOpen(false)
              setMenuOpen((current) => !current)
            }}
            aria-expanded={menuOpen}
            aria-controls="desktop-all-tabs-panel"
            aria-haspopup="dialog"
            aria-label={`Show all ${openTabEntries.length} open tabs`}
            title="Show every open tab"
          >
            <span>All tabs</span>
            <b>{openTabEntries.length}</b>
            <i aria-hidden="true">⌄</i>
          </button>
        )}
        {menuOpen && (
          <div
            id="desktop-all-tabs-panel"
            className="desktop-surface-add__menu"
            role="dialog"
            aria-label="All open tabs and workspace options"
          >
            <header className="desktop-tab-menu__header">
              <div>
                <strong>Open tabs</strong>
                <small>
                  {openTabEntries.length === 1
                    ? '1 tab in this window'
                    : `${openTabEntries.length} tabs in this window`}
                </small>
              </div>
              <button
                className="desktop-tab-menu__close"
                onClick={() => {
                  setMenuOpen(false)
                  tabMenuTriggerRef.current?.focus()
                }}
                aria-label="Close all tabs menu"
                title="Close"
              >
                ×
              </button>
            </header>
            <div className="desktop-tab-menu__list">
              {openTabEntries.length === 0 && (
                <p className="desktop-tab-menu__empty">
                  No tabs are open. Start a new chat or reopen a view below.
                </p>
              )}
              {openTabEntries.map((entry) => {
                if (entry.kind === 'surface') {
                  const surface = DESKTOP_SURFACES.find(
                    (candidate) => candidate.id === entry.id
                  )
                  if (!surface) return null
                  return (
                    <button
                      key={entry.key}
                      className={`desktop-tab-menu__item${entry.active ? ' active' : ''}`}
                      onClick={() => {
                        setMenuOpen(false)
                        navigate(surface.to)
                      }}
                      aria-current={entry.active ? 'page' : undefined}
                      title={`Open ${entry.label}`}
                    >
                      <NavIcon name={surface.icon} />
                      <span className="desktop-tab-menu__copy">
                        <strong>{entry.label}</strong>
                        <small>View</small>
                      </span>
                      {entry.active && (
                        <span className="desktop-tab-menu__state current">
                          Current
                        </span>
                      )}
                    </button>
                  )
                }
                const tab = chatTabs.find(
                  (candidate) => candidate.sessionId === entry.id
                )
                if (!tab) return null
                const session = sessions.find(
                  (candidate) => candidate.id === tab.sessionId
                )
                const run = activeRuns.find(
                  (candidate) => candidate.sessionId === tab.sessionId
                )
                return (
                  <button
                    key={entry.key}
                    className={`desktop-tab-menu__item${entry.active ? ' active' : ''}`}
                    onClick={() => {
                      setMenuOpen(false)
                      void openChatTab(tab)
                    }}
                    aria-current={entry.active ? 'page' : undefined}
                    title={`Open ${entry.label}`}
                  >
                    <NavIcon name="ask" />
                    <span className="desktop-tab-menu__copy">
                      <strong>{entry.label}</strong>
                      <small>
                        {session?.projectLabel ||
                          (tab.scope === 'work'
                            ? 'Workspace chat'
                            : 'Personal chat')}
                      </small>
                    </span>
                    {run ? (
                      <span className="desktop-tab-menu__state running">
                        {runTabStatus(run)}
                      </span>
                    ) : entry.active ? (
                      <span className="desktop-tab-menu__state current">
                        Current
                      </span>
                    ) : null}
                  </button>
                )
              })}
            </div>
            <button
              className="desktop-tab-menu__cleanup"
              onClick={() =>
                void closeTaskTabs(
                  oldChatTabIds,
                  `Close ${oldChatTabIds.length} old inactive tab${oldChatTabIds.length === 1 ? '' : 's'}?`,
                  'The conversations stay saved in the sidebar.'
                )
              }
              disabled={oldChatTabIds.length === 0}
              title={
                oldChatTabIds.length > 0
                  ? 'Close saved inactive tabs older than seven days; conversations remain available'
                  : 'No saved inactive tabs are older than seven days'
              }
            >
              <NavIcon name="history" />
              <span>Close old tabs</span>
              <b>{oldChatTabIds.length}</b>
            </button>
            <button
              className="desktop-tab-menu__cleanup"
              onClick={() =>
                void closeTaskTabs(
                  otherChatTabIds,
                  `Close ${otherChatTabIds.length} other inactive task tab${otherChatTabIds.length === 1 ? '' : 's'}?`,
                  'The current task, running tasks, unsent drafts, and saved conversations are preserved.'
                )
              }
              disabled={otherChatTabIds.length === 0}
              title="Close every other saved idle task tab; keep the current task, running tasks, and drafts"
            >
              <NavIcon name="tasks" />
              <span>Close all other task tabs</span>
              <b>{otherChatTabIds.length}</b>
            </button>
            <span className="desktop-surface-add__label">Workspace</span>
            <button
              onClick={() => {
                setMenuOpen(false)
                openWorkspaceTool('new-project')
              }}
            >
              <NavIcon name="workspace" />
              <span>Create project workspace</span>
            </button>
            <button
              onClick={() => {
                setMenuOpen(false)
                openWorkspaceTool('open-project')
              }}
            >
              <NavIcon name="workspace" />
              <span>Open project folder</span>
            </button>
            <span className="desktop-surface-add__label">Browser</span>
            <button
              onClick={() => {
                setMenuOpen(false)
                openSurface('browser')
              }}
            >
              <NavIcon name="browser" />
              <span>Open controlled browser</span>
            </button>
            <span className="desktop-surface-add__label">Simulator</span>
            <button
              onClick={() => {
                setMenuOpen(false)
                openSurface('simulator')
              }}
            >
              <NavIcon name="simulator" />
              <span>Open device workspace</span>
            </button>
            <span className="desktop-surface-add__label">View</span>
            <button
              onClick={() => {
                setMenuOpen(false)
                openWorkspaceTool('explorer')
              }}
            >
              <NavIcon name="workspace" />
              <span>Browse files</span>
            </button>
            <button
              onClick={() => {
                setMenuOpen(false)
                openWorkspaceTool('editor')
              }}
            >
              <NavIcon name="workspace" />
              <span>Open editor</span>
            </button>
            <button
              onClick={() => {
                setMenuOpen(false)
                openWorkspaceTool('agent')
              }}
            >
              <NavIcon name="ask" />
              <span>Ask Intelligence</span>
            </button>
            <button
              onClick={() => {
                setMenuOpen(false)
                openWorkspaceTool('changes')
              }}
            >
              <NavIcon name="workspace" />
              <span>Review changes</span>
            </button>
            <button
              onClick={() => {
                setMenuOpen(false)
                openWorkspaceTool('more')
              }}
            >
              <NavIcon name="workspace" />
              <span>More workspace tools</span>
            </button>
            {closedSurfaces.length > 0 && (
              <span className="desktop-surface-add__label">Closed tabs</span>
            )}
            {closedSurfaces.map((surface) => (
              <button
                key={surface.id}
                onClick={() => openSurface(surface.id)}
              >
                <NavIcon name={surface.icon} />
                <span>{surface.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function primaryIntelligenceSessionId(): string {
  const stored = localStorage.getItem(PRIMARY_INTELLIGENCE_SESSION_KEY)
  if (stored && stored.length <= 160) return stored
  const sessionId = crypto.randomUUID().toUpperCase()
  localStorage.setItem(PRIMARY_INTELLIGENCE_SESSION_KEY, sessionId)
  return sessionId
}

function RunActivityPreview({ preview }: { preview: AgentRunPreview }) {
  return (
    <details className="desktop-run-center__preview">
      <summary>
        <span>{preview.title}</span>
        {typeof preview.additions === 'number' && (
          <small>+{preview.additions} −{preview.deletions ?? 0}</small>
        )}
      </summary>
      {(preview.before !== undefined || preview.after !== undefined) && (
        <div className="desktop-run-center__preview-diff">
          <pre>{preview.before || '(empty)'}</pre>
          <pre>{preview.after || '(empty)'}</pre>
        </div>
      )}
      {preview.body && <pre>{preview.body}</pre>}
      {preview.items && preview.items.length > 0 && (
        <ul>
          {preview.items.map((item, index) => (
            <li key={`${item.label}-${index}`}>
              <b>{item.label}</b>
              {item.detail && <span>{item.detail}</span>}
            </li>
          ))}
        </ul>
      )}
    </details>
  )
}

function InvestigationInspector({
  run,
  step,
  onBack,
  onOpenConversation,
  onFollowUp,
}: {
  run: ActiveAgentRun
  step: AgentRunStepSummary
  onBack: () => void
  onOpenConversation: () => void
  onFollowUp: () => void
}) {
  const preview = step.preview?.kind === 'investigation' ? step.preview : null
  if (!preview) return null
  const sources = [...new Set(preview.sourceUrls ?? [])]
  const summary = preview.summary?.trim()
  const statusLabel =
    step.status === 'running'
      ? 'Researching'
      : step.status === 'done'
        ? 'Complete'
        : step.status === 'error'
          ? 'Needs attention'
          : 'Queued'

  return (
    <aside
      className="desktop-investigation-inspector"
      aria-label={`${preview.title} research workstream`}
    >
      <header>
        <button type="button" onClick={onBack} aria-label="Back to active runs">
          ←
        </button>
        <div>
          <small>Research workstream</small>
          <b>{preview.title}</b>
        </div>
        <span data-status={step.status}>{statusLabel}</span>
      </header>
      <div className="desktop-investigation-inspector__body">
        <section className="desktop-investigation-inspector__brief">
          <small>Objective</small>
          <p>{preview.objective}</p>
          <div>
            <span>{step.agent || 'Investigator'}</span>
            <span>{run.title}</span>
            {step.resultMeta && <span>{step.resultMeta}</span>}
          </div>
        </section>
        {summary ? (
          <section className="desktop-investigation-inspector__summary">
            <small>
              {step.status === 'running' ? 'Latest summary' : 'Executive summary'}
            </small>
            <p>{summary}</p>
          </section>
        ) : (
          <div className="desktop-investigation-inspector__pending">
            <span className="intel-dot intel-dot--running" />
            <div>
              <b>Building a source-backed summary</b>
              <small>
                Findings will appear here when this workstream reports back.
              </small>
            </div>
          </div>
        )}
        {sources.length > 0 && (
          <details className="desktop-investigation-inspector__sources">
            <summary>
              Sources reviewed <b>{sources.length}</b>
            </summary>
            <ol>
              {sources.map((url) => (
                <li key={url}>
                  <a href={url} target="_blank" rel="noopener noreferrer">
                    <b>{researchSourceHost(url)}</b>
                    <span>{researchSourcePath(url)}</span>
                  </a>
                </li>
              ))}
            </ol>
          </details>
        )}
      </div>
      <footer>
        <button type="button" onClick={onOpenConversation}>
          Open conversation
        </button>
        <button
          type="button"
          className="primary"
          onClick={onFollowUp}
          disabled={step.status === 'running'}
          title={
            step.status === 'running'
              ? 'Follow up when this research workstream finishes'
              : undefined
          }
        >
          Follow up
        </button>
      </footer>
    </aside>
  )
}

function activeRunResearchSummary(steps: AgentRunStepSummary[]): string {
  const investigations = steps.filter((step) => step.name === 'investigation')
  if (investigations.length === 0) return ''
  const complete = investigations.filter((step) => step.status === 'done').length
  const running = investigations.filter((step) => step.status === 'running').length
  const sourceCount = new Set(
    investigations.flatMap((step) =>
      step.preview?.kind === 'investigation'
        ? step.preview.sourceUrls ?? []
        : []
    )
  ).size
  const parts = [
    `${investigations.length} ${
      investigations.length === 1 ? 'workstream' : 'workstreams'
    }`,
  ]
  if (running > 0) parts.push(`${running} active`)
  if (complete > 0) parts.push(`${complete} summarized`)
  if (sourceCount > 0) {
    parts.push(`${sourceCount} ${sourceCount === 1 ? 'source' : 'sources'}`)
  }
  return parts.join(' · ')
}

function investigationFollowUpPrompt(step: AgentRunStepSummary): string {
  const title =
    step.preview?.kind === 'investigation'
      ? step.preview.title
      : step.label || 'this research'
  return `Follow up on the research workstream “${title}”. Review its evidence and answer this next question: `
}

function researchSourcePath(url: string): string {
  try {
    const parsed = new URL(url)
    return (
      decodeURIComponent(parsed.pathname).replace(/\/?$/, '').replace(/^\//, '') ||
      parsed.hostname
    )
  } catch {
    return url
  }
}

function researchSourceHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

function runTabStatus(run: ActiveAgentRun | undefined): string {
  if (!run) return ''
  if (run.phase === 'queued') {
    return run.providerQueuePosition
      ? `queued ${run.providerQueuePosition}`
      : 'queued'
  }
  if (run.phase === 'stopping') return 'stopping'
  if (run.phase === 'needs-input') return 'needs you'
  if (run.phase === 'finishing') return 'finishing'
  if (run.phase === 'responding') return 'writing'
  return 'running'
}

function runActivityLabel(run: ActiveAgentRun): string {
  if (run.phase === 'queued') return 'Waiting to start'
  if (run.phase === 'starting') return 'Getting ready'
  if (run.phase === 'thinking') return 'Choosing the next step'
  if (run.phase === 'finishing') return 'Wrapping up'
  if (run.phase === 'responding') return 'Writing the response'
  if (run.phase === 'stopping') return 'Stopping safely'
  if (run.phase === 'needs-input') return 'Needs your approval'
  return 'Working on it'
}

function orchestrationRunLabel(
  value: ActiveAgentRun['orchestrationMode']
): string {
  if (value === 'parallel') return 'Parallel'
  if (value === 'adaptive') return 'Adaptive'
  return 'Focused'
}

function formatRunElapsed(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1_000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m`
}

function persistClosedChatTabIds(sessionIds: string[]): string[] {
  localStorage.setItem(
    DESKTOP_CLOSED_CHAT_TABS_KEY,
    JSON.stringify(sessionIds)
  )
  return sessionIds
}

function loadDesktopSidebarChatHeight(): number {
  const raw = localStorage.getItem(DESKTOP_SIDEBAR_CHAT_HEIGHT_KEY)
  if (raw == null) return DEFAULT_DESKTOP_SIDEBAR_CHAT_HEIGHT
  const stored = Number(raw)
  if (!Number.isFinite(stored)) return DEFAULT_DESKTOP_SIDEBAR_CHAT_HEIGHT
  return Math.max(
    MIN_DESKTOP_SIDEBAR_CHAT_HEIGHT,
    Math.min(760, Math.round(stored))
  )
}

function desktopSurfaceForPath(pathname: string) {
  if (pathname.startsWith('/workspace')) {
    return DESKTOP_SURFACES.find((surface) => surface.id === 'workspace')
  }
  if (pathname.startsWith('/browser')) {
    return DESKTOP_SURFACES.find((surface) => surface.id === 'browser')
  }
  if (pathname.startsWith('/cad')) {
    return DESKTOP_SURFACES.find((surface) => surface.id === 'cad')
  }
  if (pathname.startsWith('/github')) {
    return DESKTOP_SURFACES.find((surface) => surface.id === 'github')
  }
  if (pathname.startsWith('/plan')) {
    return DESKTOP_SURFACES.find((surface) => surface.id === 'plan')
  }
  if (pathname.startsWith('/calendar')) {
    return DESKTOP_SURFACES.find((surface) => surface.id === 'calendar')
  }
  return undefined
}

function DesktopNavLink({
  to,
  label,
  icon,
  end,
}: {
  to: string
  label: string
  icon: DesktopIcon
  end?: boolean
}) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `desktop-nav-item${isActive ? ' desktop-nav-item--active' : ''}`
      }
    >
      <NavIcon name={icon} />
      <span>{label}</span>
    </NavLink>
  )
}

function NavIcon({ name }: { name: DesktopIcon }) {
  const common = {
    width: 18,
    height: 18,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  }

  switch (name) {
    case 'ask':
      return <svg {...common}><path d="m12 3 1.35 4.15L17.5 8.5l-4.15 1.35L12 14l-1.35-4.15L6.5 8.5l4.15-1.35L12 3Z" /><path d="m18.5 14 .7 2.3 2.3.7-2.3.7-.7 2.3-.7-2.3-2.3-.7 2.3-.7.7-2.3Z" /></svg>
    case 'workspace':
      return <svg {...common}><path d="M3.5 6.5h6l2 2h9v10a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-12Z" /><path d="M3.5 10h17" /></svg>
    case 'browser':
      return <svg {...common}><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M3 8.5h18" /><circle cx="6" cy="6.25" r=".7" fill="currentColor" stroke="none" /><path d="M8.5 6.25h8" /></svg>
    case 'simulator':
      return <svg {...common}><rect x="7" y="2.5" width="10" height="19" rx="2.5" /><path d="M10 5h4M11 18.5h2" /><path d="M3 8.5v7M21 8.5v7" /></svg>
    case 'cad':
      return <svg {...common}><path d="m12 2.8 8 4.5v9.4l-8 4.5-8-4.5V7.3l8-4.5Z" /><path d="m4 7.3 8 4.5 8-4.5M12 11.8v9.4" /><circle cx="12" cy="11.8" r="2.1" /></svg>
    case 'github':
      return <svg {...common}><circle cx="6" cy="6" r="2" /><circle cx="18" cy="6" r="2" /><circle cx="12" cy="18" r="2" /><path d="M6 8v2.5c0 1.7 1.3 3 3 3h3M18 8v2.5c0 1.7-1.3 3-3 3h-3v2.5" /></svg>
    case 'plan':
      return <svg {...common}><rect x="4" y="4.5" width="16" height="15.5" rx="3" /><path d="M8 2.5v4M16 2.5v4M4 9h16M8 13h3M8 16.5h6" /></svg>
    case 'calendar':
      return <svg {...common}><rect x="3.5" y="4.5" width="17" height="16" rx="3" /><path d="M8 2.5v4M16 2.5v4M3.5 9h17" /><circle cx="12" cy="14.5" r="1.6" fill="currentColor" stroke="none" /></svg>
    case 'tasks':
      return <svg {...common}><rect x="4" y="4" width="7" height="7" rx="2" /><rect x="13" y="13" width="7" height="7" rx="2" /><path d="M11 7.5h3a3 3 0 0 1 3 3V13M13 16.5h-3a3 3 0 0 1-3-3V11" /></svg>
    case 'today':
      return <svg {...common}><rect x="3.5" y="4.5" width="17" height="16" rx="3" /><path d="M8 2.5v4M16 2.5v4M3.5 9h17" /><path d="M8 13h3v3H8z" /></svg>
    case 'record':
      return <svg {...common}><circle cx="12" cy="12" r="8.5" /><path d="M12 8v8M8 12h8" /></svg>
    case 'insights':
      return <svg {...common}><path d="M4 17.5 9 12l3.2 3.2L20 6.5" /><path d="M15 6.5h5v5" /></svg>
    case 'library':
      return <svg {...common}><path d="M5 4.5h11a3 3 0 0 1 3 3v12H8a3 3 0 0 1-3-3v-12Z" /><path d="M8 4.5v15M11 9h5M11 12.5h4" /></svg>
    case 'history':
      return <svg {...common}><path d="M4.4 8A8.5 8.5 0 1 1 3.5 12" /><path d="M4.5 4v4h4M12 7.5V12l3 2" /></svg>
    case 'people':
      return <svg {...common}><circle cx="9" cy="8" r="3" /><path d="M3.5 19c.6-3.3 2.4-5 5.5-5s4.9 1.7 5.5 5M15 6.5a3 3 0 0 1 0 5.8M16 14c2.5.2 4 1.8 4.5 4.5" /></svg>
    case 'routes':
      return <svg {...common}><circle cx="6" cy="18" r="2" /><circle cx="18" cy="6" r="2" /><path d="M7.5 16.5c2.5-2.2 1.2-5.2 3.5-7.2 1.2-1 2.8-1.4 5.3-1.8" /></svg>
    case 'store':
      return <svg {...common}><path d="M4 9.5h16l-1 10H5l-1-10Z" /><path d="M8 9.5V7a4 4 0 0 1 8 0v2.5" /></svg>
    case 'models':
      return <svg {...common}><path d="M4 7.5 12 3l8 4.5-8 4.5-8-4.5Z" /><path d="m4 12 8 4.5 8-4.5M4 16.5 12 21l8-4.5" /></svg>
    case 'enterprise':
      return <svg {...common}><path d="M4 20V6l8-3 8 3v14M8 9h2M14 9h2M8 13h2M14 13h2M10 20v-3h4v3" /></svg>
    case 'founder':
      return <svg {...common}><path d="M12 2.8 20 6v5.8c0 4.8-3.1 8-8 9.4-4.9-1.4-8-4.6-8-9.4V6l8-3.2Z" /><path d="M8 13.8V10l4-2 4 2v3.8M10 14v-2h4v2" /></svg>
    case 'settings':
      return <svg {...common}><circle cx="12" cy="12" r="3" /><path d="M19 13.5v-3l-2-.6a7 7 0 0 0-.7-1.7l1-1.9-2.1-2.1-1.9 1a7 7 0 0 0-1.7-.7L11 2.5H8l-.6 2a7 7 0 0 0-1.7.7l-1.9-1-2.1 2.1 1 1.9A7 7 0 0 0 2 9.9l-2 .6v3l2 .6a7 7 0 0 0 .7 1.7l-1 1.9 2.1 2.1 1.9-1a7 7 0 0 0 1.7.7l.6 2h3l.6-2a7 7 0 0 0 1.7-.7l1.9 1 2.1-2.1-1-1.9a7 7 0 0 0 .7-1.7l2-.6Z" transform="translate(2 0) scale(.83)" /></svg>
    case 'more':
      return <svg {...common}><circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none" /></svg>
    case 'lock':
      return <svg {...common}><rect x="5.5" y="10.5" width="13" height="9" rx="2.5" /><path d="M8.5 10.5V7.75a3.5 3.5 0 0 1 7 0v2.75" /><path d="M12 14.25v2" /></svg>
  }
}

function desktopRouteTitle(pathname: string): string {
  if (pathname.startsWith('/flow/history')) return 'Conversations'
  if (pathname.startsWith('/flow')) return 'Intelligence'
  if (pathname.startsWith('/founder')) return 'Founder Console'
  if (pathname.startsWith('/workspace')) return 'Workspace'
  if (pathname.startsWith('/browser')) return 'Browser'
  if (pathname.startsWith('/simulator')) return 'Simulator'
  if (pathname.startsWith('/cad')) return 'Parametric CAD'
  if (pathname.startsWith('/github')) return 'GitHub workspace'
  if (pathname.startsWith('/plan')) return 'Plan'
  if (pathname.startsWith('/calendar')) return 'Calendar'
  if (pathname.startsWith('/tasks')) return 'Parallel tasks'
  if (pathname.startsWith('/health')) return 'Health'
  if (pathname.startsWith('/dashboard')) return 'Today'
  if (pathname.startsWith('/record')) return 'Record'
  if (pathname.startsWith('/insights')) return 'Insights'
  if (pathname.startsWith('/library')) return 'Library'
  if (pathname.startsWith('/history')) return 'Health history'
  if (pathname.startsWith('/friends')) return 'People'
  if (pathname.startsWith('/routes')) return 'Routes'
  if (pathname.startsWith('/profile')) return 'Connections & settings'
  if (pathname.startsWith('/settings')) return 'Settings'
  if (pathname.startsWith('/models')) return 'Models & keys'
  if (pathname.startsWith('/customize')) return 'Customize'
  if (pathname.startsWith('/tokens')) return 'Store'
  if (pathname.startsWith('/enterprise')) return 'Enterprise'
  return 'StatsKey'
}

interface DesktopChatGroup {
  key: string
  label: string
  kind: 'project' | 'personal' | 'other'
  project?: DesktopRecentProject
  isCurrent: boolean
  sessions: ChatSession[]
}

const CHAT_GROUP_PREVIEW_COUNT = 5
const CHAT_GROUP_EXPANDED_COUNT = 30

function DesktopSidebarChats({
  authenticated,
  uid,
  pathname,
  search,
  navigate,
}: {
  authenticated: boolean
  uid: string | undefined
  pathname: string
  search: string
  navigate: (to: string) => void
}) {
  const local = useRecentLocalChatSessions(80)
  const cloud = useRecentChatSessions(uid, 40)
  const sessions = useMemo(
    () =>
      mergeChatSessions(local.sessions, cloud.sessions, 150).filter(
        (session) => session.archivedAt == null
      ),
    [local.sessions, cloud.sessions]
  )
  const [activeRuns, setActiveRuns] = useState<ActiveAgentRun[]>(
    getActiveAgentRuns
  )
  const [recents, setRecents] = useState<DesktopRecentProject[]>([])
  const [binding, setBinding] = useState<WorkspaceProjectBinding | null>(null)
  const [workspaceImportError, setWorkspaceImportError] = useState<
    string | null
  >(null)
  const [workspaceFilter, setWorkspaceFilter] = useState('')
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({})
  const [expandedGroups, setExpandedGroups] = useState<
    Record<string, boolean>
  >({})
  const [, setTimeTick] = useState(0)

  useEffect(() => {
    const refresh = () => setActiveRuns(getActiveAgentRuns())
    window.addEventListener(AGENT_RUN_STATE_EVENT, refresh)
    const interval = window.setInterval(
      () => setTimeTick((tick) => tick + 1),
      60_000
    )
    return () => {
      window.removeEventListener(AGENT_RUN_STATE_EVENT, refresh)
      window.clearInterval(interval)
    }
  }, [])

  useEffect(() => {
    let active = true
    const bridge = getDesktopBridge()
    if (!bridge) return
    const refresh = () =>
      void Promise.all([
        bridge.workspace.recentProjects().catch(() => []),
        currentProjectBinding().catch(() => null),
      ]).then(([projects, current]) => {
        if (!active) return
        setRecents(projects)
        setBinding(current)
      })
    refresh()
    const unsubscribe = bridge.workspace.onState(refresh)
    return () => {
      active = false
      unsubscribe()
    }
  }, [pathname])

  const groups = useMemo(
    () => buildDesktopChatGroups(sessions, recents, binding, authenticated),
    [sessions, recents, binding, authenticated]
  )
  const workspaceCount = groups.filter(
    (group) => group.kind === 'project'
  ).length
  const workspaceQuery = workspaceFilter.trim().toLocaleLowerCase()
  const visibleGroups = useMemo(() => {
    if (!workspaceQuery) return groups
    return groups.filter(
      (group) =>
        group.label.toLocaleLowerCase().includes(workspaceQuery) ||
        group.sessions.some((session) =>
          session.title.toLocaleLowerCase().includes(workspaceQuery)
        )
    )
  }, [groups, workspaceQuery])
  const activeSessionId =
    pathname === '/flow'
      ? new URLSearchParams(search).get('session')
      : null

  async function openConversation(
    group: DesktopChatGroup,
    session: ChatSession
  ) {
    const scope =
      (session.contextScope ?? 'personal') === 'work' ? 'work' : 'personal'
    if (scope === 'work') {
      const opened = await ensureDesktopProjectOpen(
        {
          projectId: session.projectId ?? group.project?.id,
          projectLabel: session.projectLabel ?? group.label,
          projectRoots: session.projectRoots ?? group.project?.roots,
        },
        recents
      )
      if (!opened.ok) {
        showToast(opened.error, { kind: 'error' })
        return
      }
      if (opened.binding) setBinding(opened.binding)
    }
    navigate(
      `/flow?session=${encodeURIComponent(session.id)}&scope=${scope}`
    )
  }

  async function startChatInGroup(group: DesktopChatGroup) {
    const sessionId = crypto.randomUUID().toUpperCase()
    if (group.kind === 'personal') {
      navigate(`/flow?session=${encodeURIComponent(sessionId)}&scope=personal`)
      return
    }
    if (group.project) {
      const opened = await ensureDesktopProjectOpen(
        {
          projectId: group.project.id,
          projectLabel: group.label,
          projectRoots: group.project.roots,
        },
        recents
      )
      if (!opened.ok) {
        showToast(opened.error, { kind: 'error' })
        return
      }
      if (opened.binding) setBinding(opened.binding)
    }
    navigate(`/flow?session=${encodeURIComponent(sessionId)}&scope=work`)
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent(SUMMON_FOCUS_EVENT))
    }, 50)
  }

  async function archiveConversation(session: ChatSession) {
    if (activeRuns.some((run) => run.sessionId === session.id)) {
      showToast(
        'Let this conversation finish or stop it before archiving it.',
        { kind: 'info' }
      )
      return
    }
    const next = await archiveLocalChatSession(session, true)
    if (uid) await saveChatSession(uid, next)
    if (activeSessionId === session.id) navigate('/flow/history')
  }

  async function deleteConversation(session: ChatSession) {
    if (activeRuns.some((run) => run.sessionId === session.id)) {
      showToast(
        'Let this conversation finish or stop it before deleting it.',
        { kind: 'info' }
      )
      return
    }
    const confirmed = await confirmDialog({
      title: `Delete “${session.title}”?`,
      body: 'The conversation is removed permanently and cannot be recovered.',
      confirmLabel: 'Delete',
      destructive: true,
    })
    if (!confirmed) return
    await deleteLocalChatSession(session.id)
    await clearAgentLocalState(session.id)
    if (uid) await deleteChatSession(uid, session.id)
    if (activeSessionId === session.id) navigate('/flow/history')
  }

  async function archiveGroup(group: DesktopChatGroup) {
    const available = group.sessions.filter(
      (session) =>
        !activeRuns.some((run) => run.sessionId === session.id)
    )
    if (available.length === 0) return
    const confirmed = await confirmDialog({
      title: `Archive ${available.length} conversation${available.length === 1 ? '' : 's'} in “${group.label}”?`,
      body: 'Archived conversations leave the sidebar but stay in your history.',
      confirmLabel: 'Archive',
    })
    if (!confirmed) return
    for (const session of available) {
      const next = await archiveLocalChatSession(session, true)
      if (uid) await saveChatSession(uid, next)
    }
    if (
      activeSessionId &&
      available.some((session) => session.id === activeSessionId)
    ) {
      navigate('/flow/history')
    }
  }

  async function openProjectWorkspace(
    group: DesktopChatGroup,
    tool: WorkspaceQuickTool = 'explorer'
  ) {
    const bridge = getDesktopBridge()
    if (!bridge || !group.project) {
      showToast('That workspace is unavailable in this desktop session.', {
        kind: 'error',
      })
      return
    }
    try {
      const result = await bridge.workspace.openRecentProject(group.project.id)
      if (!result.ok || !result.workspace) {
        showToast(
          result.error ||
            'That workspace could not be opened. Its folder may have moved.',
          { kind: 'error' }
        )
        return
      }
    } catch (error) {
      showToast(
        error instanceof Error
          ? error.message
          : 'That workspace could not be opened.',
        { kind: 'error' }
      )
      return
    }
    requestWorkspaceQuickTool(tool)
    navigate('/workspace')
  }

  async function saveProjectGroup(group: DesktopChatGroup) {
    const bridge = getDesktopBridge()
    if (!bridge || !group.project) return
    const alreadySaved = group.project.saved
    const name = await promptDialog({
      title: alreadySaved ? 'Rename workspace' : 'Rename and save workspace',
      body: alreadySaved
        ? 'The new name appears everywhere this workspace is shown.'
        : 'The name appears in the sidebar and in recent workspaces.',
      label: 'Workspace name',
      initialValue: group.label,
      confirmLabel: alreadySaved ? 'Rename' : 'Save',
    })
    if (!name?.trim()) return
    const result = await bridge.workspace.renameRecentProject(
      group.project.id,
      name.trim()
    )
    if (!result.ok) {
      showToast(result.error || 'The workspace could not be saved.', {
        kind: 'error',
      })
      return
    }
    setRecents(await bridge.workspace.recentProjects())
  }

  async function deleteProjectGroup(group: DesktopChatGroup) {
    const bridge = getDesktopBridge()
    if (!bridge || group.kind !== 'project') return
    const runningConversation = group.sessions.find((session) =>
      activeRuns.some((run) => run.sessionId === session.id)
    )
    if (runningConversation) {
      showToast(
        `Let “${runningConversation.title}” finish or stop it before deleting this workspace.`,
        { kind: 'info' }
      )
      return
    }
    const conversationCount = group.sessions.length
    const confirmed = await confirmDialog({
      title: `Delete workspace “${group.label}”?`,
      body: `This removes the workspace from StatsKey${
        group.isCurrent ? ' and closes it' : ''
      }${
        conversationCount > 0
          ? `, and archives its ${conversationCount} conversation${
              conversationCount === 1 ? '' : 's'
            }`
          : ''
      }. Project files stay on disk${
        conversationCount > 0
          ? ' and conversations stay available in All conversations'
          : ''
      }.`,
      confirmLabel: 'Delete workspace',
      destructive: true,
    })
    if (!confirmed) return

    try {
      for (const session of group.sessions) {
        const next = await archiveLocalChatSession(session, true)
        if (uid) await saveChatSession(uid, next)
      }
      if (group.isCurrent) {
        await bridge.workspace.closeWorkspace()
        setBinding(null)
      }
      if (group.project) {
        const removed = await bridge.workspace.removeRecentProject(
          group.project.id
        )
        if (!removed) {
          throw new Error('That workspace could not be removed from StatsKey.')
        }
      }
      setRecents(await bridge.workspace.recentProjects())
      setOpenGroups((current) => {
        const next = { ...current }
        delete next[group.key]
        return next
      })
      setExpandedGroups((current) => {
        const next = { ...current }
        delete next[group.key]
        return next
      })
      if (
        group.isCurrent ||
        (activeSessionId &&
          group.sessions.some((session) => session.id === activeSessionId))
      ) {
        navigate(group.isCurrent ? '/workspace' : '/flow/history')
      }
      showToast(`“${group.label}” was removed from StatsKey.`, {
        kind: 'success',
      })
    } catch (error) {
      showToast(
        error instanceof Error
          ? error.message
          : 'That workspace could not be deleted.',
        { kind: 'error' }
      )
    }
  }

  async function finishWorkspaceImport(next: DesktopWorkspaceState) {
    const bridge = getDesktopBridge()
    if (!bridge) return
    const projects = await bridge.workspace.recentProjects().catch(() => [])
    setRecents(projects)
    setBinding(projectBindingForWorkspace(next, projects))
    navigate('/workspace')
  }

  async function addWorkspaceFromFolders() {
    const bridge = getDesktopBridge()
    if (!bridge) return
    const next = await bridge.workspace.createFromFolders().catch(() => null)
    if (next) await finishWorkspaceImport(next)
  }

  async function importWorkspaceFile() {
    const bridge = getDesktopBridge()
    if (!bridge) return
    setWorkspaceImportError(null)
    try {
      const result = await bridge.workspace.importWorkspaceFile()
      if (result.cancelled) return
      const importError = workspaceImportResultError(result)
      if (importError || !result.workspace) {
        setWorkspaceImportError(
          importError || 'The workspace file could not be imported.'
        )
        return
      }
      await finishWorkspaceImport(result.workspace)
    } catch (importError) {
      setWorkspaceImportError(
        importError instanceof Error
          ? importError.message
          : 'The workspace file could not be imported.'
      )
    }
  }

  async function importCursorWorkspaces() {
    const bridge = getDesktopBridge()
    if (!bridge) return
    setWorkspaceImportError(null)
    if (!bridge.workspace.importCursorWorkspaces) {
      setWorkspaceImportError(
        'Import from Cursor requires the latest StatsKey Desktop build.'
      )
      return
    }
    try {
      const result = await bridge.workspace.importCursorWorkspaces()
      if (!result.ok) {
        setWorkspaceImportError(
          result.error || 'Cursor workspaces could not be imported.'
        )
        return
      }
      setRecents(await bridge.workspace.recentProjects())
      const ignoredEntries =
        result.skipped > 0
          ? ` · ${result.skipped} non-workspace or unavailable ${
              result.skipped === 1 ? 'entry' : 'entries'
            } ignored`
          : ''
      showToast(
        result.imported > 0
          ? `${result.total} Cursor workspace${
              result.total === 1 ? '' : 's'
            } ready · ${result.imported} newly imported${ignoredEntries}`
          : `${result.total} Cursor workspace${
              result.total === 1 ? ' is' : 's are'
            } already ready${ignoredEntries}`,
        { kind: 'success' }
      )
    } catch (importError) {
      setWorkspaceImportError(
        importError instanceof Error
          ? importError.message
          : 'Cursor workspaces could not be imported.'
      )
    }
  }

  return (
    <section className="desktop-sidebar__chats" aria-label="Conversations">
      <div className="desktop-sidebar__workspace-heading">
        <div className="desktop-sidebar__section-label">
          <span>Workspaces</span>
          {workspaceCount > 0 && <b>{workspaceCount}</b>}
        </div>
        <details className="desktop-sidebar__workspace-add">
          <summary aria-label="Add or import a workspace" title="Add workspace">
            +
          </summary>
          <div
            onClickCapture={(event) =>
              event.currentTarget
                .closest('details')
                ?.removeAttribute('open')
            }
          >
            <button onClick={() => void importCursorWorkspaces()}>
              Import all from Cursor
            </button>
            <button onClick={() => void addWorkspaceFromFolders()}>
              Add workspace from folders…
            </button>
            <button onClick={() => void importWorkspaceFile()}>
              Import workspace file…
            </button>
          </div>
        </details>
      </div>
      {workspaceCount > 8 && (
        <label className="desktop-sidebar__workspace-filter">
          <span aria-hidden="true">⌕</span>
          <input
            value={workspaceFilter}
            onChange={(event) => setWorkspaceFilter(event.target.value)}
            placeholder="Find a workspace"
            aria-label="Find a workspace"
          />
          {workspaceFilter && (
            <button
              type="button"
              onClick={() => setWorkspaceFilter('')}
              aria-label="Clear workspace search"
            >
              ×
            </button>
          )}
        </label>
      )}
      {workspaceImportError && (
        <div className="workspace-import-error" role="alert">
          {workspaceImportError}
        </div>
      )}
      {visibleGroups.map((group) => {
        const labelMatches =
          workspaceQuery.length > 0 &&
          group.label.toLocaleLowerCase().includes(workspaceQuery)
        const visibleSessions =
          workspaceQuery && !labelMatches
            ? group.sessions.filter((session) =>
                session.title.toLocaleLowerCase().includes(workspaceQuery)
              )
            : group.sessions
        const open =
          openGroups[group.key] ??
          (group.isCurrent || groups.length === 1 || workspaceQuery.length > 0)
        const shown = expandedGroups[group.key]
          ? visibleSessions.slice(0, CHAT_GROUP_EXPANDED_COUNT)
          : visibleSessions.slice(0, CHAT_GROUP_PREVIEW_COUNT)
        const groupSummary = desktopChatGroupSummary(group)
        return (
          <div
            className={`desktop-chat-group${
              group.isCurrent ? ' current' : ''
            }`}
            key={group.key}
          >
            {group.kind === 'personal' && (
              <div className="desktop-sidebar__section-label">Personal chats</div>
            )}
            <div className="desktop-chat-group__header">
              <button
                className="desktop-chat-group__toggle"
                onClick={() => {
                  if (group.kind === 'project' && group.sessions.length === 0) {
                    void openProjectWorkspace(group, 'explorer')
                    return
                  }
                  setOpenGroups((current) => ({
                    ...current,
                    [group.key]: !open,
                  }))
                }}
                aria-expanded={group.sessions.length > 0 ? open : undefined}
                aria-current={group.isCurrent ? 'true' : undefined}
                title={
                  group.kind === 'project' && group.sessions.length === 0
                    ? `Open ${group.label}`
                    : undefined
                }
              >
                <i
                  className="desktop-chat-group__mark"
                  data-tone={desktopWorkspaceTone(group.label)}
                  aria-hidden="true"
                >
                  {desktopWorkspaceMark(group.label)}
                </i>
                <span className="desktop-chat-group__copy">
                  <strong>{group.label}</strong>
                  {groupSummary && <small>{groupSummary}</small>}
                </span>
                <b
                  className={`desktop-chat-group__disclosure${
                    group.sessions.length > 0 && open ? ' open' : ''
                  }`}
                  aria-hidden="true"
                >
                  ›
                </b>
              </button>
              <div className="desktop-chat-group__actions">
                <button
                  className="desktop-chat-group__new"
                  onClick={() => void startChatInGroup(group)}
                  aria-label={`New chat in ${group.label}`}
                  title={`New chat in ${group.label}`}
                >
                  +
                </button>
                {(group.sessions.length > 0 || group.kind === 'project') && (
                  <details>
                    <summary aria-label={`Manage ${group.label}`}>•••</summary>
                    <div
                      onClickCapture={(event) =>
                        event.currentTarget
                          .closest('details')
                          ?.removeAttribute('open')
                      }
                    >
                      {group.kind === 'project' && (
                        <>
                          <button
                            onClick={() =>
                              void openProjectWorkspace(group, 'explorer')
                            }
                          >
                            Browse files
                          </button>
                          <button
                            onClick={() =>
                              void openProjectWorkspace(group, 'search-files')
                            }
                          >
                            Search workspace
                          </button>
                          <button
                            onClick={() =>
                              void openProjectWorkspace(group, 'add-files')
                            }
                          >
                            Add files
                          </button>
                          {group.project && (
                            <button onClick={() => void saveProjectGroup(group)}>
                              {group.project.saved
                                ? 'Rename workspace'
                                : 'Rename and save'}
                            </button>
                          )}
                          <button
                            className="danger"
                            onClick={() => void deleteProjectGroup(group)}
                          >
                            Delete workspace
                          </button>
                        </>
                      )}
                      {group.sessions.length > 0 && (
                        <button onClick={() => void archiveGroup(group)}>
                          Archive conversations
                        </button>
                      )}
                    </div>
                  </details>
                )}
              </div>
            </div>
            {open && (shown.length > 0 || group.kind === 'personal') && (
              <div className="desktop-chat-group__items">
                {shown.map((session) => {
                  const running = activeRuns.some(
                    (run) => run.sessionId === session.id
                  )
                  const active = activeSessionId === session.id
                  return (
                    <div
                      key={session.id}
                      className={`desktop-chat-item${
                        active ? ' active' : ''
                      }`}
                    >
                      <button
                        className="desktop-chat-item__open"
                        onClick={() => void openConversation(group, session)}
                        aria-current={active ? 'page' : undefined}
                        title={
                          running
                            ? `${session.title} · Intelligence is working`
                            : session.title
                        }
                      >
                        {running && (
                          <i
                            className="desktop-chat-item__running"
                            aria-hidden="true"
                          />
                        )}
                        <span>{session.title}</span>
                        <time>{relativeChatTime(session.updatedAt)}</time>
                      </button>
                      <details className="desktop-chat-item__menu">
                        <summary aria-label={`Manage ${session.title}`}>•••</summary>
                        <div
                          onClickCapture={(event) =>
                            event.currentTarget
                              .closest('details')
                              ?.removeAttribute('open')
                          }
                        >
                          <button onClick={() => void archiveConversation(session)}>
                            Archive
                          </button>
                          <button
                            className="danger"
                            onClick={() => void deleteConversation(session)}
                          >
                            Delete
                          </button>
                        </div>
                      </details>
                    </div>
                  )
                })}
                {group.sessions.length === 0 && group.kind === 'personal' && (
                  <p className="desktop-chat-group__empty">
                    No conversations yet.
                  </p>
                )}
                {visibleSessions.length > shown.length && (
                  <button
                    className="desktop-chat-group__more"
                    onClick={() =>
                      setExpandedGroups((current) => ({
                        ...current,
                        [group.key]: true,
                      }))
                    }
                  >
                    More
                  </button>
                )}
              </div>
            )}
          </div>
        )
      })}
      {workspaceFilter && visibleGroups.length === 0 && (
        <p className="desktop-sidebar__workspace-empty">
          No matching workspace.
        </p>
      )}
      <NavLink to="/flow/history" className="desktop-chats-all">
        All conversations
      </NavLink>
    </section>
  )
}

function buildDesktopChatGroups(
  sessions: ChatSession[],
  recents: DesktopRecentProject[],
  binding: WorkspaceProjectBinding | null,
  authenticated: boolean
): DesktopChatGroup[] {
  const projectGroups: DesktopChatGroup[] = []
  const byKey = new Map<string, DesktopChatGroup>()

  if (binding) {
    const project =
      (binding.id
        ? recents.find((candidate) => candidate.id === binding.id)
        : undefined) ??
      recents.find((candidate) =>
        sameProjectRoots(candidate.roots, binding.roots)
      )
    const key = binding.id ?? project?.id ?? binding.roots.join('\n')
    const group: DesktopChatGroup = {
      key,
      label: binding.label,
      kind: 'project',
      project,
      isCurrent: true,
      sessions: [],
    }
    byKey.set(key, group)
    if (project) byKey.set(project.id, group)
    projectGroups.push(group)
  }

  for (const project of recents) {
    if (byKey.has(project.id)) continue
    const group: DesktopChatGroup = {
      key: project.id,
      label: compactChatProjectLabel(
        project.name.replace(/\.code-workspace$/i, '')
      ),
      kind: 'project',
      project,
      isCurrent: false,
      sessions: [],
    }
    byKey.set(project.id, group)
    projectGroups.push(group)
  }

  const personal: DesktopChatGroup = {
    key: 'personal',
    label: 'Personal',
    kind: 'personal',
    isCurrent: false,
    sessions: [],
  }
  const other: DesktopChatGroup = {
    key: 'other',
    label: 'Other chats',
    kind: 'other',
    isCurrent: false,
    sessions: [],
  }

  for (const session of sessions) {
    if ((session.contextScope ?? 'personal') === 'personal') {
      personal.sessions.push(session)
      continue
    }
    let group: DesktopChatGroup | null =
      (session.projectId && byKey.get(session.projectId)) || null
    if (!group && session.projectRoots?.length) {
      group =
        projectGroups.find(
          (candidate) =>
            (candidate.project &&
              sameProjectRoots(
                candidate.project.roots,
                session.projectRoots
              )) ||
            (candidate.isCurrent &&
              binding &&
              sameProjectRoots(binding.roots, session.projectRoots))
        ) ?? null
    }
    if (!group && session.projectLabel) {
      group =
        projectGroups.find(
          (candidate) => candidate.label === session.projectLabel
        ) ?? null
      if (!group) {
        group = {
          key: `label:${session.projectLabel}`,
          label: session.projectLabel,
          kind: 'project',
          isCurrent: false,
          sessions: [],
        }
        byKey.set(group.key, group)
        projectGroups.push(group)
      }
    }
    ;(group ?? other).sessions.push(session)
  }

  const visible = projectGroups
  if (authenticated) visible.push(personal)
  if (other.sessions.length > 0) visible.push(other)
  return visible
}

function compactChatProjectLabel(value: string): string {
  const label = value.trim() || 'Workspace'
  return label.length > 30 ? `${label.slice(0, 27)}…` : label
}

function desktopWorkspaceMark(label: string): string {
  const words = label.match(/[a-z0-9]+/gi) ?? []
  if (words.length > 1) {
    return `${words[0]?.[0] ?? 'W'}${words.at(-1)?.[0] ?? ''}`.toLocaleUpperCase()
  }
  return (words[0] ?? 'W').slice(0, 2).toLocaleUpperCase()
}

function desktopWorkspaceTone(label: string): number {
  return [...label].reduce((value, character) => {
    return (value * 31 + character.charCodeAt(0)) % 6
  }, 0)
}

function desktopChatGroupSummary(group: DesktopChatGroup): string {
  if (group.kind === 'personal') {
    return group.sessions.length === 1
      ? '1 private conversation'
      : `${group.sessions.length} private conversations`
  }
  if (group.isCurrent) return 'Open now'
  if (group.sessions.length > 0) {
    return group.sessions.length === 1
      ? '1 conversation'
      : `${group.sessions.length} conversations`
  }
  const folderCount = group.project?.roots.length ?? 0
  return folderCount > 1 ? `${folderCount} folders` : ''
}

async function ensureDesktopProjectOpen(
  target: {
    projectId?: string
    projectLabel?: string
    projectRoots?: string[]
  },
  knownRecents?: DesktopRecentProject[]
): Promise<
  | { ok: true; binding: WorkspaceProjectBinding | null }
  | { ok: false; error: string }
> {
  const bridge = getDesktopBridge()
  const targetRoots = Array.isArray(target.projectRoots)
    ? [...target.projectRoots].sort()
    : []
  if (!bridge || (!target.projectId && targetRoots.length === 0)) {
    return { ok: true, binding: null }
  }

  const current = await bridge.workspace.getState().catch(() => null)
  const currentMatches = target.projectId
    ? current?.workspaceId === target.projectId
    : Boolean(
        current &&
          sameProjectRoots(
            current.roots.map((root) => root.path),
            targetRoots
          )
      )
  if (current && currentMatches) {
    const recents =
      knownRecents ??
      (await bridge.workspace.recentProjects().catch(() => []))
    return {
      ok: true,
      binding: projectBindingForWorkspace(current, recents),
    }
  }

  const recents =
    knownRecents ??
    (await bridge.workspace.recentProjects().catch(() => []))
  const project = target.projectId
    ? recents.find((candidate) => candidate.id === target.projectId)
    : recents.find((candidate) =>
        sameProjectRoots(candidate.roots, targetRoots)
      )
  if (!project) {
    return {
      ok: false,
      error: `Open ${target.projectLabel || 'the conversation’s workspace'} before continuing this conversation.`,
    }
  }

  try {
    const result = await bridge.workspace.openRecentProject(project.id)
    if (!result.ok || !result.workspace) {
      return {
        ok: false,
        error:
          result.error ||
          `The ${project.name} workspace could not be opened.`,
      }
    }
    const openedMatches = target.projectId
      ? result.workspace.workspaceId === target.projectId
      : sameProjectRoots(
          result.workspace.roots.map((root) => root.path),
          targetRoots
        )
    if (!openedMatches) {
      return {
        ok: false,
        error: `StatsKey did not open the expected ${project.name} workspace.`,
      }
    }
    return {
      ok: true,
      binding: projectBindingForWorkspace(result.workspace, recents),
    }
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : `The ${project.name} workspace could not be opened.`,
    }
  }
}

function workspaceBindingForSession(
  session: ChatSession
): WorkspaceProjectBinding | null {
  const roots = Array.isArray(session.projectRoots)
    ? [...session.projectRoots]
    : []
  if (!session.projectId && roots.length === 0) return null
  return {
    id: session.projectId,
    label: session.projectLabel?.trim() || 'Workspace',
    roots,
  }
}

function relativeChatTime(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1_000)
  if (seconds < 60) return 'now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d`
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })
}

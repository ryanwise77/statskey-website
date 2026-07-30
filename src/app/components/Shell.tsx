import { useEffect, useRef } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'

const NAV_ITEMS: { to: string; label: string; end?: boolean }[] = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/record', label: 'Record' },
  { to: '/insights', label: 'Insights' },
  { to: '/flow', label: 'Intelligence' },
  { to: '/library', label: 'Library' },
  { to: '/friends', label: 'Friends' },
  { to: '/routes', label: 'Routes' },
  { to: '/history', label: 'History' },
  { to: '/tokens', label: 'Store' },
  { to: '/profile', label: 'Profile' },
]

export function Shell() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const stripRef = useRef<HTMLDivElement>(null)

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

  async function handleSignOut() {
    await signOut()
    navigate('/login', { replace: true })
  }

  return (
    <div className="app-shell">
      <nav className="app-nav">
        <div className="max-w-[1080px] mx-auto px-4 sm:px-6 h-12 flex items-center justify-between gap-3">
          <div className="flex items-center gap-6 min-w-0">
            <a href="/" className="app-brand">
              <span className="site-brand__mark" aria-hidden="true" />
              <span>StatsKey</span>
            </a>
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
      <main className="app-main max-w-[1080px] mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <Outlet />
      </main>
    </div>
  )
}

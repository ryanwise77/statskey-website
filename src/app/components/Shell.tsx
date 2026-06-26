import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'

export function Shell() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()

  async function handleSignOut() {
    await signOut()
    navigate('/login', { replace: true })
  }

  return (
    <div className="app-shell">
      <nav className="app-nav">
        <div className="max-w-[1080px] mx-auto px-6 h-12 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <a href="/" className="font-display font-semibold text-[14px] tracking-[-0.01em] text-text-primary/80 hover:text-text-primary transition-colors">StatsKey</a>
            <div className="flex items-center gap-5 text-[13px] text-text-muted">
              <NavLink to="/" end className={({ isActive }) => isActive ? 'text-text-primary' : 'hover:text-text-primary transition-colors'}>Dashboard</NavLink>
              <NavLink to="/record" className={({ isActive }) => isActive ? 'text-text-primary' : 'hover:text-text-primary transition-colors'}>Record</NavLink>
              <NavLink to="/flow" className={({ isActive }) => isActive ? 'text-text-primary' : 'hover:text-text-primary transition-colors'}>Intelligence</NavLink>
              <NavLink to="/tokens" className={({ isActive }) => isActive ? 'text-text-primary' : 'hover:text-text-primary transition-colors'}>Store</NavLink>
              <NavLink to="/friends" className={({ isActive }) => isActive ? 'text-text-primary' : 'hover:text-text-primary transition-colors'}>Friends</NavLink>
              <NavLink to="/routes" className={({ isActive }) => isActive ? 'text-text-primary' : 'hover:text-text-primary transition-colors'}>Routes</NavLink>
              <NavLink to="/history" className={({ isActive }) => isActive ? 'text-text-primary' : 'hover:text-text-primary transition-colors'}>History</NavLink>
              <NavLink to="/profile" className={({ isActive }) => isActive ? 'text-text-primary' : 'hover:text-text-primary transition-colors'}>Profile</NavLink>
            </div>
          </div>
          <div className="flex items-center gap-4 text-[12px] text-text-muted">
            <span className="hidden sm:inline">{user?.email}</span>
            <button className="btn btn-ghost" onClick={handleSignOut}>Sign out</button>
          </div>
        </div>
      </nav>
      <main className="max-w-[1080px] mx-auto px-6 py-8">
        <Outlet />
      </main>
    </div>
  )
}

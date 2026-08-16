import { useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  getDesktopBridge,
  GOOGLE_CONNECTION_EVENT,
  SUMMON_FOCUS_EVENT,
} from '../lib/desktop'
import { useAuth } from '../lib/auth'

export function DesktopBridge({ pendingCount }: { pendingCount: number }) {
  const bridge = getDesktopBridge()
  const navigate = useNavigate()
  const location = useLocation()
  const { user } = useAuth()
  const previousCount = useRef<number | null>(null)

  useEffect(() => {
    bridge?.setBadge(pendingCount)
  }, [bridge, pendingCount])

  useEffect(() => {
    if (!bridge) return
    const previous = previousCount.current
    previousCount.current = pendingCount
    if (previous === null || pendingCount <= previous) return
    if (!document.hidden && document.hasFocus()) return
    bridge.notify({
      title: 'StatsKey',
      body:
        pendingCount === 1
          ? 'One action is waiting for your OK.'
          : `${pendingCount} actions are waiting for your OK.`,
    })
  }, [bridge, pendingCount])

  useEffect(() => {
    if (!bridge) return
    return bridge.onSummon(() => {
      if (
        location.pathname !== '/flow' &&
        location.pathname !== '/workspace'
      ) {
        navigate(user ? '/flow' : '/flow?scope=work')
        window.setTimeout(() => {
          window.dispatchEvent(new CustomEvent(SUMMON_FOCUS_EVENT))
        }, 0)
        return
      }
      window.dispatchEvent(new CustomEvent(SUMMON_FOCUS_EVENT))
    })
  }, [bridge, navigate, location.pathname, user])

  useEffect(() => {
    if (!bridge) return
    return bridge.onOpenUrl((rawUrl) => {
      try {
        const url = new URL(rawUrl)
        if (
          url.protocol !== 'statskey-desktop:' ||
          url.hostname !== 'oauth' ||
          url.pathname !== '/google'
        ) {
          return
        }
        const status = url.searchParams.get('status')
        if (status !== 'connected' && status !== 'failed') return
        if (location.pathname !== '/profile') navigate('/profile')
        window.dispatchEvent(
          new CustomEvent(GOOGLE_CONNECTION_EVENT, { detail: { status } })
        )
      } catch {
        // Ignore malformed protocol messages.
      }
    })
  }, [bridge, navigate, location.pathname])

  return null
}

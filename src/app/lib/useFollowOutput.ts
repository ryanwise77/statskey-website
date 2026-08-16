import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type UIEvent,
} from 'react'

const FOLLOW_THRESHOLD_PX = 72

export function isNearOutputBottom(
  scrollHeight: number,
  scrollTop: number,
  clientHeight: number,
  threshold = FOLLOW_THRESHOLD_PX
): boolean {
  return scrollHeight - scrollTop - clientHeight <= threshold
}

export function nextFollowOutputState({
  wasFollowing,
  previousScrollTop,
  scrollTop,
  scrollHeight,
  clientHeight,
}: {
  wasFollowing: boolean
  previousScrollTop: number
  scrollTop: number
  scrollHeight: number
  clientHeight: number
}): boolean {
  if (isNearOutputBottom(scrollHeight, scrollTop, clientHeight)) return true
  if (scrollTop < previousScrollTop - 1) return false
  return wasFollowing
}

/**
 * Keeps streaming output pinned only while the reader is already at the end.
 * Scrolling up pauses following immediately; returning to the bottom or
 * pressing "Jump to latest" resumes it.
 */
export function useFollowOutput<T extends HTMLElement>() {
  const scrollRef = useRef<T>(null)
  const followingRef = useRef(true)
  const previousScrollTop = useRef(0)
  const scheduledFrame = useRef<number | null>(null)
  const settleFrame = useRef<number | null>(null)
  const [isFollowingOutput, setIsFollowingOutput] = useState(true)

  const updateFollowing = useCallback((next: boolean) => {
    followingRef.current = next
    setIsFollowingOutput(next)
  }, [])

  const scheduleLatest = useCallback((force: boolean) => {
    if (!force && !followingRef.current) return
    // Coalesce high-frequency streaming updates into one pending frame rather
    // than repeatedly canceling it and potentially starving the actual scroll.
    if (scheduledFrame.current != null) return
    scheduledFrame.current = window.requestAnimationFrame(() => {
      scheduledFrame.current = null
      const viewport = scrollRef.current
      if (!viewport || (!force && !followingRef.current)) return
      viewport.scrollTo({ top: viewport.scrollHeight, behavior: 'auto' })
      previousScrollTop.current = viewport.scrollTop
      if (force) {
        if (settleFrame.current != null) {
          window.cancelAnimationFrame(settleFrame.current)
        }
        settleFrame.current = window.requestAnimationFrame(() => {
          settleFrame.current = null
          const settledViewport = scrollRef.current
          if (!settledViewport) return
          previousScrollTop.current = settledViewport.scrollTop
          updateFollowing(
            isNearOutputBottom(
              settledViewport.scrollHeight,
              settledViewport.scrollTop,
              settledViewport.clientHeight
            )
          )
        })
      }
    })
  }, [updateFollowing])

  const handleScroll = useCallback(
    (event: UIEvent<T>) => {
      const viewport = event.currentTarget
      const next = nextFollowOutputState({
        wasFollowing: followingRef.current,
        previousScrollTop: previousScrollTop.current,
        scrollTop: viewport.scrollTop,
        scrollHeight: viewport.scrollHeight,
        clientHeight: viewport.clientHeight,
      })
      previousScrollTop.current = viewport.scrollTop
      updateFollowing(next)
    },
    [updateFollowing]
  )

  const pauseFollowing = useCallback(() => {
    updateFollowing(false)
  }, [updateFollowing])

  const jumpToLatest = useCallback(() => {
    updateFollowing(true)
    scheduleLatest(true)
  }, [scheduleLatest, updateFollowing])

  const followLatestIfEnabled = useCallback(() => {
    scheduleLatest(false)
  }, [scheduleLatest])

  useEffect(
    () => () => {
      if (scheduledFrame.current != null) {
        window.cancelAnimationFrame(scheduledFrame.current)
      }
      if (settleFrame.current != null) {
        window.cancelAnimationFrame(settleFrame.current)
      }
    },
    []
  )

  return {
    scrollRef,
    isFollowingOutput,
    handleScroll,
    pauseFollowing,
    jumpToLatest,
    followLatestIfEnabled,
  }
}

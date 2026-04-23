import { useEffect, useState } from 'react'
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  where,
} from 'firebase/firestore'
import { db } from '../firebase'
import { toDateOrNow } from '../firestore'

type Raw = Record<string, unknown>

export type FriendshipStatus = 'pending' | 'accepted' | 'active' | 'blocked'

export interface Friendship {
  id: string
  users: string[]
  senderId?: string
  targetIdentifier?: string
  status: FriendshipStatus
  createdAt: Date
}

export interface FriendSocial {
  uid: string
  displayName?: string
  username?: string
  email?: string
  avatarURL?: string
}

export interface Friend {
  uid: string
  friendship: Friendship
  social: FriendSocial
}

function decodeFriendship(raw: Raw, id: string): Friendship {
  const users = Array.isArray(raw.users) ? (raw.users as unknown[]).filter((u) => typeof u === 'string') as string[] : []
  const rawStatus = typeof raw.status === 'string' ? raw.status : 'pending'
  const status: FriendshipStatus = (['pending', 'accepted', 'active', 'blocked'] as FriendshipStatus[]).includes(
    rawStatus as FriendshipStatus
  )
    ? (rawStatus as FriendshipStatus)
    : 'pending'
  return {
    id,
    users,
    senderId: (typeof raw.senderId === 'string' ? raw.senderId : (typeof raw.initiatorId === 'string' ? raw.initiatorId : undefined)),
    targetIdentifier: typeof raw.targetIdentifier === 'string' ? raw.targetIdentifier : undefined,
    status,
    createdAt: toDateOrNow(raw.createdAt),
  }
}

export function isConnected(f: Friendship): boolean {
  return f.status === 'accepted' || f.status === 'active'
}

export interface FriendshipsState {
  friendships: Friendship[]
  loading: boolean
  error: string | null
}

export function useFriendships(uid: string | undefined): FriendshipsState {
  const [state, setState] = useState<FriendshipsState>({ friendships: [], loading: true, error: null })

  useEffect(() => {
    if (!uid) {
      setState({ friendships: [], loading: false, error: null })
      return
    }
    const q = query(collection(db, 'friendships'), where('users', 'array-contains', uid))
    const unsub = onSnapshot(
      q,
      (snap) => {
        const friendships = snap.docs.map((d) => decodeFriendship(d.data() as Raw, d.id))
        setState({ friendships, loading: false, error: null })
      },
      (err) => setState({ friendships: [], loading: false, error: err.message })
    )
    return () => unsub()
  }, [uid])

  return state
}

/**
 * Fetch a friend's social profile, falling back to their root user doc for name/email
 * when the social profile is missing. Matches fetchSocialProfile + fallback at
 * biometrics/StatsKey/Services/DatabaseService.swift:638-673.
 */
export async function fetchFriendSocial(friendUid: string): Promise<FriendSocial> {
  const socialSnap = await getDoc(doc(db, 'users', friendUid, 'social', 'profile')).catch(() => null)
  if (socialSnap?.exists()) {
    const raw = socialSnap.data() as Raw
    return {
      uid: friendUid,
      displayName: str(raw.displayName) ?? str(raw['display_name']) ?? str(raw.name),
      username: str(raw.username),
      email: str(raw.email),
      avatarURL: str(raw.avatarURL) ?? str(raw['avatar_url']) ?? str(raw.photoURL),
    }
  }
  const userSnap = await getDoc(doc(db, 'users', friendUid)).catch(() => null)
  if (userSnap?.exists()) {
    const raw = userSnap.data() as Raw
    return {
      uid: friendUid,
      displayName: str(raw.name) ?? str(raw.displayName),
      email: str(raw.email),
    }
  }
  return { uid: friendUid }
}

/**
 * React hook that turns an array of friendship docs into resolved Friend objects
 * with their social profiles. Filters out the current user (only returns the OTHER UID).
 */
export function useFriends(uid: string | undefined): {
  friends: Friend[]
  loading: boolean
  error: string | null
} {
  const { friendships, loading: fshipLoading, error } = useFriendships(uid)
  const [friends, setFriends] = useState<Friend[]>([])
  const [resolving, setResolving] = useState(false)

  useEffect(() => {
    if (!uid || fshipLoading) return
    let cancelled = false
    setResolving(true)

    ;(async () => {
      const connected = friendships.filter(isConnected)
      const tasks = connected.map(async (f) => {
        const other = f.users.find((u) => u !== uid)
        if (!other) return null
        const social = await fetchFriendSocial(other)
        return { uid: other, friendship: f, social } as Friend
      })
      const resolved = (await Promise.all(tasks)).filter((x): x is Friend => x != null)
      if (!cancelled) {
        setFriends(resolved)
        setResolving(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [uid, friendships, fshipLoading])

  return { friends, loading: fshipLoading || resolving, error }
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined
}

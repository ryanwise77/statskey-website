import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  useLinkedSyncStates,
  useWorkspaceSyncStatuses,
} from '../../lib/sync/useWorkspaceSync'

function sameRootSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length || a.length === 0) return false
  const sortedA = [...a].sort()
  const sortedB = [...b].sort()
  return sortedA.every((path, index) => path === sortedB[index])
}

// Live-sync status pill for the explorer toolbar. Renders nothing unless the
// open workspace's roots exactly match a live-synced workspace linked on this
// device.
export function WorkspaceSyncPill({ rootPaths }: { rootPaths: string[] }) {
  const navigate = useNavigate()
  const linked = useLinkedSyncStates()
  const statuses = useWorkspaceSyncStatuses()

  const match = useMemo(() => {
    for (const state of linked) {
      if (!state.syncId.startsWith('ws_')) continue
      const mapped = state.rootMappings.map((mapping) => mapping.path)
      if (sameRootSet(mapped, rootPaths)) return state
    }
    return null
  }, [linked, rootPaths])

  if (!match) return null
  const status = statuses.find((row) => row.syncId === match.syncId) ?? null

  let tone = 'idle'
  let label = 'Synced'
  if (!status) {
    tone = 'idle'
    label = 'Sync starting…'
  } else if (status.guard) {
    tone = 'attention'
    label = 'Sync needs review'
  } else if (status.state === 'paused') {
    tone = 'paused'
    label = 'Sync paused'
  } else if (status.state === 'offline') {
    tone = 'paused'
    label = 'Sync offline'
  } else if (status.state === 'error') {
    tone = 'attention'
    label = 'Sync error'
  } else if (status.state === 'attention') {
    tone = 'attention'
    label = 'Synced, some skipped'
  } else if (status.pendingUploads > 0 || status.pendingApplies > 0) {
    tone = 'busy'
    label =
      status.pendingUploads > 0
        ? `Syncing ↑${status.pendingUploads}`
        : `Syncing ↓${status.pendingApplies}`
  }

  return (
    <button
      className={`workspace-sync-pill workspace-sync-pill--${tone}`}
      onClick={() => navigate('/settings/sync')}
      title="Live sync status — open Sync & backup settings"
    >
      {label}
    </button>
  )
}

import { randomSyncId } from './snapshotStore'
import { SYNC_DEVICE_ID_KEY, SYNC_DEVICE_LABEL_KEY } from './types'

// The sync device id is deliberately NOT the workspaceId hash — that value is
// machine-path-specific and unusable as cross-device identity. This id is
// minted once per browser profile and never changes.
export function getSyncDeviceId(): string {
  const existing = localStorage.getItem(SYNC_DEVICE_ID_KEY)
  if (existing && /^dev_[a-f0-9]{20}$/.test(existing)) return existing
  const created = randomSyncId('dev')
  localStorage.setItem(SYNC_DEVICE_ID_KEY, created)
  return created
}

export function getSyncDeviceLabel(bridgeLabel: string | null): string {
  const override = localStorage.getItem(SYNC_DEVICE_LABEL_KEY)
  if (override && override.trim().length > 0) {
    return override.trim().slice(0, 80)
  }
  if (bridgeLabel && bridgeLabel.trim().length > 0) {
    return bridgeLabel.trim().slice(0, 80)
  }
  return 'This device'
}

export function setSyncDeviceLabel(label: string): void {
  const cleaned = label.trim().slice(0, 80)
  if (cleaned.length === 0) {
    // Clearing the override falls back to the bridge-provided hostname label.
    localStorage.removeItem(SYNC_DEVICE_LABEL_KEY)
    return
  }
  localStorage.setItem(SYNC_DEVICE_LABEL_KEY, cleaned)
}

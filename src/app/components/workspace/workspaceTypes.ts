import type { DesktopWorkspaceFile } from '../../lib/desktop'

export interface OpenWorkspaceDocument {
  file: DesktopWorkspaceFile
  draft: string
  dirty: boolean
  line: number | null
}

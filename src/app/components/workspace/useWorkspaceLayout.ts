import { useCallback, useEffect, useState } from 'react'

export type WorkspaceBottomPanel = 'terminal' | 'changes' | null
export type WorkspaceAgentSide = 'left' | 'right'
export type WorkspaceLayoutPresetId =
  | 'simple'
  | 'balanced'
  | 'editor'
  | 'agent'
  | 'review'

export interface WorkspaceLayoutState {
  editorOpen: boolean
  explorerOpen: boolean
  explorerWidth: number
  agentOpen: boolean
  agentWidth: number
  agentSide: WorkspaceAgentSide
  bottomPanel: WorkspaceBottomPanel
  bottomHeight: number
  canvasMode: boolean
  simpleMode: boolean
}

export interface WorkspaceLayoutPreset {
  id: WorkspaceLayoutPresetId
  label: string
  description: string
  layout: WorkspaceLayoutState
}

// v7 introduces the progressive workspace: the active work and Intelligence
// lead, while files and review tools remain one action away.
const STORAGE_KEY = 'statskey.workspace.layout.v7'
const LEGACY_STORAGE_KEYS = [
  'statskey.workspace.layout.v6',
  'statskey.workspace.layout.v5',
  'statskey.workspace.layout.v4',
  'statskey.workspace.layout.v3',
]

export const WORKSPACE_LAYOUT_PRESETS: WorkspaceLayoutPreset[] = [
  {
    id: 'agent',
    label: 'Focus',
    description: 'The active work and Intelligence, without the file tree.',
    layout: {
      editorOpen: true,
      explorerOpen: false,
      explorerWidth: 220,
      agentOpen: true,
      agentWidth: 520,
      agentSide: 'right',
      bottomPanel: null,
      bottomHeight: 280,
      canvasMode: false,
      simpleMode: false,
    },
  },
  {
    id: 'simple',
    label: 'Intelligence',
    description: 'One calm surface. Open files and tools only when needed.',
    layout: {
      editorOpen: false,
      explorerOpen: false,
      explorerWidth: 200,
      agentOpen: true,
      agentWidth: 520,
      agentSide: 'right',
      bottomPanel: null,
      bottomHeight: 280,
      canvasMode: false,
      simpleMode: false,
    },
  },
  {
    id: 'editor',
    label: 'Editor',
    description: 'A single, uninterrupted file surface.',
    layout: {
      editorOpen: true,
      explorerOpen: false,
      explorerWidth: 220,
      agentOpen: false,
      agentWidth: 370,
      agentSide: 'right',
      bottomPanel: null,
      bottomHeight: 280,
      canvasMode: true,
      simpleMode: false,
    },
  },
  {
    id: 'balanced',
    label: 'Full workspace',
    description: 'Files, active work, and Intelligence together.',
    layout: {
      editorOpen: true,
      explorerOpen: true,
      explorerWidth: 220,
      agentOpen: true,
      agentWidth: 370,
      agentSide: 'right',
      bottomPanel: null,
      bottomHeight: 280,
      canvasMode: false,
      simpleMode: false,
    },
  },
  {
    id: 'review',
    label: 'Review changes',
    description: 'Files, changes, editor, and Intelligence visible.',
    layout: {
      editorOpen: true,
      explorerOpen: true,
      explorerWidth: 210,
      agentOpen: true,
      agentWidth: 340,
      agentSide: 'right',
      bottomPanel: 'changes',
      bottomHeight: 300,
      canvasMode: false,
      simpleMode: false,
    },
  },
]

const DEFAULT_LAYOUT = WORKSPACE_LAYOUT_PRESETS.find(
  (preset) => preset.id === 'agent'
)!.layout

export function useWorkspaceLayout() {
  const [layout, setLayout] = useState<WorkspaceLayoutState>(loadLayout)

  useEffect(() => {
    const timer = window.setTimeout(() => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(layout))
    }, 250)
    return () => window.clearTimeout(timer)
  }, [layout])

  const patchLayout = useCallback(
    (patch: Partial<WorkspaceLayoutState>) =>
      setLayout((current) => normalizeLayout({ ...current, ...patch })),
    []
  )

  const applyPreset = useCallback((presetId: WorkspaceLayoutPresetId) => {
    const preset = WORKSPACE_LAYOUT_PRESETS.find(
      (candidate) => candidate.id === presetId
    )
    if (preset) setLayout(preset.layout)
  }, [])

  const toggleBottomPanel = useCallback((panel: Exclude<WorkspaceBottomPanel, null>) => {
    setLayout((current) => ({
      ...current,
      bottomPanel: current.bottomPanel === panel ? null : panel,
    }))
  }, [])

  const resetLayout = useCallback(() => {
    setLayout(DEFAULT_LAYOUT)
  }, [])

  return {
    layout,
    patchLayout,
    applyPreset,
    toggleBottomPanel,
    resetLayout,
  }
}

export function clampExplorerWidth(value: number): number {
  return Math.min(480, Math.max(120, Math.round(value)))
}

export function clampAgentWidth(value: number): number {
  return Math.min(1200, Math.max(260, Math.round(value)))
}

export function clampBottomHeight(value: number): number {
  return Math.min(520, Math.max(180, Math.round(value)))
}

function loadLayout(): WorkspaceLayoutState {
  const stored = readStoredLayout(STORAGE_KEY)
  if (stored) {
    return normalizeLayout({
      ...DEFAULT_LAYOUT,
      ...stored,
    })
  }

  for (const key of LEGACY_STORAGE_KEYS) {
    const legacy = readStoredLayout(key)
    if (!legacy) continue
    if (key === 'statskey.workspace.layout.v6') {
      return normalizeLayout(DEFAULT_LAYOUT)
    }
    const normalized = normalizeLayout({
      ...DEFAULT_LAYOUT,
      ...legacy,
    })
    return shouldMigrateLegacyLayout(normalized)
      ? normalizeLayout(DEFAULT_LAYOUT)
      : normalized
  }

  return normalizeLayout(DEFAULT_LAYOUT)
}

function readStoredLayout(key: string): Partial<WorkspaceLayoutState> | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    return parsed && typeof parsed === 'object'
      ? (parsed as Partial<WorkspaceLayoutState>)
      : null
  } catch {
    return null
  }
}

function shouldMigrateLegacyLayout(layout: WorkspaceLayoutState): boolean {
  return (
    layout.simpleMode ||
    (!layout.editorOpen &&
      !layout.explorerOpen &&
      layout.agentOpen &&
      layout.bottomPanel == null &&
      !layout.canvasMode)
  )
}

function normalizeLayout(
  candidate: WorkspaceLayoutState
): WorkspaceLayoutState {
  const editorOpen = candidate.editorOpen !== false
  let explorerOpen = candidate.explorerOpen !== false
  const agentOpen = candidate.agentOpen !== false
  if (!editorOpen && !explorerOpen && !agentOpen) explorerOpen = true
  return {
    editorOpen,
    explorerOpen,
    explorerWidth: clampExplorerWidth(candidate.explorerWidth),
    agentOpen,
    agentWidth: clampAgentWidth(candidate.agentWidth),
    agentSide: candidate.agentSide === 'left' ? 'left' : 'right',
    bottomPanel:
      candidate.bottomPanel === 'terminal' ||
      candidate.bottomPanel === 'changes'
        ? candidate.bottomPanel
        : null,
    bottomHeight: clampBottomHeight(candidate.bottomHeight),
    canvasMode: candidate.canvasMode === true,
    simpleMode: candidate.simpleMode === true,
  }
}

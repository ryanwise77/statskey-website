import { describe, expect, it } from 'vitest'
import {
  WorkspaceSearchRecoveryState,
  workspaceManifestProgressMeta,
  workspaceManifestAlreadyLoaded,
  workspaceSearchCandidates,
  workspaceSearchMissBudgetExhausted,
  workspaceSearchSignature,
} from './workspaceSearchRecovery'

describe('workspace search recovery', () => {
  it('treats equivalent verbose searches as the same miss', () => {
    expect(
      workspaceSearchSignature('Find CameraCaptureView.swift in the workspace')
    ).toBe(workspaceSearchSignature('CameraCaptureView.swift'))
  })

  it('broadens a natural-language search to exact filenames and identifiers', () => {
    const candidates = workspaceSearchCandidates(
      'Find CameraCaptureView.swift and mealDepthCaptureEnabled in the project'
    )
    expect(candidates).toContain('CameraCaptureView.swift')
    expect(candidates).toContain('mealDepthCaptureEnabled')
    expect(candidates.length).toBeLessThanOrEqual(6)
  })

  it('suppresses an equivalent search after its exhaustive miss', () => {
    const state = new WorkspaceSearchRecoveryState()
    const first = state.plan('Find CameraCaptureView.swift in the workspace')
    expect(first.repeatedMiss).toBe(false)
    state.record(first.signature, 0)
    const second = state.plan('CameraCaptureView.swift')
    expect(second.repeatedMiss).toBe(true)
    expect(second.previousMisses).toBe(1)
  })

  it('removes workspace search after two exhaustive misses', () => {
    expect(
      workspaceSearchMissBudgetExhausted([
        {
          name: 'workspace_search',
          status: 'done',
          resultMeta: 'workspace scan exhausted · use an exact path next',
        },
        {
          name: 'workspace_search',
          status: 'done',
          resultMeta: 'equivalent search skipped · use an exact path next',
        },
      ])
    ).toBe(true)
  })

  it('does not offer an unchanged manifest again after it was loaded', () => {
    expect(
      workspaceManifestAlreadyLoaded([
        {
          name: 'workspace_manifest',
          status: 'done',
          resultMeta: '13 workspace folders ready',
        },
      ])
    ).toBe(true)
  })

  it('reports open workspace roots instead of a misleading zero attachments line', () => {
    expect(
      workspaceManifestProgressMeta({
        available: true,
        roots: [{ name: 'StatsKey' }],
        attached_count: 0,
        added_files: [],
      })
    ).toBe('1 workspace folder ready')
  })
})

import { describe, expect, it } from 'vitest'
import { runActivityStats } from './Flow'
import type { ChatMessageStep } from '../lib/data/useChatSessions'

describe('run activity summary', () => {
  it('counts unique edits, explored files, searches, commands, and browser control', () => {
    const persistedProof = [{ label: 'Persisted change verified' }]
    const steps: ChatMessageStep[] = [
      {
        name: 'workspace_write',
        summary: 'Updated Sources/App.swift',
        resultMeta: 'file changed · persisted abcdef123456',
        preview: {
          kind: 'diff',
          title: 'Sources/App.swift',
          filePath: '/workspace/Sources/App.swift',
          additions: 3,
          deletions: 1,
          items: persistedProof,
        },
      },
      {
        name: 'workspace_write',
        summary: 'Refined Sources/App.swift',
        resultMeta: 'file changed · persisted fedcba654321',
        preview: {
          kind: 'diff',
          title: 'Sources/App.swift',
          filePath: '/workspace/Sources/App.swift',
          additions: 1,
          deletions: 0,
          items: persistedProof,
        },
      },
      {
        name: 'workspace_create',
        summary: 'Created Sources/BrowserControl.swift',
        resultMeta: 'file changed · persisted 111111111111',
        preview: {
          kind: 'diff',
          title: 'Sources/BrowserControl.swift',
          filePath: '/workspace/Sources/BrowserControl.swift',
          additions: 5,
          deletions: 0,
          items: persistedProof,
        },
      },
      {
        name: 'workspace_read',
        summary: 'Read implementation files',
        resultMeta: '3 files read',
      },
      {
        name: 'workspace_read',
        summary: 'Read one test',
        preview: {
          kind: 'files',
          title: 'Files read',
          items: [{ label: 'BrowserControlTests.swift' }],
        },
      },
      { name: 'workspace_search', summary: 'Searched workspace' },
      { name: 'workspace_search', summary: 'Searched tests' },
      { name: 'keyword_search', summary: 'Searched records' },
      { name: 'run_terminal', summary: 'Ran type check' },
      { name: 'run_terminal', summary: 'Ran tests' },
      { name: 'browser_open', summary: 'Opened preview' },
      { name: 'browser_snapshot', summary: 'Read preview controls' },
      { name: 'browser_click', summary: 'Clicked navigation' },
    ]

    expect(runActivityStats(steps)).toEqual({
      changeKind: 'authored',
      editedFiles: 2,
      additions: 9,
      deletions: 1,
      exploredFiles: 4,
      searches: 3,
      investigations: 0,
      commands: 2,
      browserActions: 3,
      totalActions: 13,
    })
  })

  it('reports task-scoped inherited diffs as reviewed files', () => {
    expect(
      runActivityStats([
        {
          name: 'git_diff',
          summary: 'Reviewed existing task changes',
          resultMeta: 'scoped diff read',
          preview: {
            kind: 'diff',
            title: 'Task-scoped existing changes',
            additions: 12,
            deletions: 4,
            body: 'diff --git a/A.swift b/A.swift',
            items: [{ label: 'A.swift' }, { label: 'B.swift' }],
          },
        },
      ])
    ).toMatchObject({
      changeKind: 'inherited',
      editedFiles: 2,
      additions: 12,
      deletions: 4,
    })
  })

  it('counts completed research workstreams without counting failed ones', () => {
    expect(
      runActivityStats([
        {
          name: 'investigation',
          summary: 'Compare two architecture approaches',
        },
        {
          name: 'investigation',
          summary: 'Check packaging support',
          failed: true,
        },
      ])
    ).toMatchObject({
      investigations: 1,
      totalActions: 2,
    })
  })
})

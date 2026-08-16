import { describe, expect, it } from 'vitest'
import {
  isProviderRoundTimeout,
  toolsForAgentMode,
  toolsForRound,
  type AgentStep,
  type AgentTurnParams,
} from './agent'

describe('agent round tool availability', () => {
  it('maps Firebase callable deadlines to the managed provider timeout path', () => {
    expect(isProviderRoundTimeout({ code: 'functions/deadline-exceeded' })).toBe(
      true
    )
    expect(isProviderRoundTimeout(new Error('permission-denied'))).toBe(false)
  })

  it('gives the screenshot work request file and command tools before provider dispatch', () => {
    const params = {
      agentMode: 'agent',
      taskExpectation: 'workspace-change',
      contextScope: 'work',
      orchestrationMode: 'focused',
      userText:
        'Finish building the product so I can remote into mac mini from my phone',
    } as unknown as AgentTurnParams

    const names = toolsForAgentMode(params).map((tool) => tool.name)
    expect(names).toContain('workspace_write')
    expect(names).toContain('workspace_create')
    expect(names).toContain('run_terminal')

    const askNames = toolsForAgentMode({
      ...params,
      agentMode: 'ask',
      taskExpectation: 'answer',
    }).map((tool) => tool.name)
    expect(askNames).not.toContain('workspace_write')
    expect(askNames).not.toContain('run_terminal')
  })

  it('keeps a bounded exact review lane during action rounds without reopening discovery', () => {
    const params = {
      agentMode: 'agent',
      taskExpectation: 'workspace-change',
    } as unknown as AgentTurnParams
    const failedWrite = (id: string): AgentStep => ({
      id,
      name: 'workspace_write',
      summary: 'workspace_write(edits: [1])',
      resultMeta: 'failed · exact edit did not match',
      status: 'error',
      agent: 'Builder',
      rationale: 'Complete the requested workspace change.',
    })
    const tools = [
      { name: 'workspace_write' },
      { name: 'workspace_read' },
      { name: 'git_diff' },
      { name: 'workspace_search' },
      { name: 'workspace_manifest' },
      { name: 'git_status' },
      { name: 'run_terminal' },
    ]

    expect(
      toolsForRound(params, tools, 6, [
        failedWrite('write-1'),
        failedWrite('write-2'),
      ]).map((tool) => tool.name)
    ).toEqual(['workspace_write', 'workspace_read', 'git_diff'])

    expect(
      toolsForRound(params, tools, 6, [
        failedWrite('write-1'),
        failedWrite('write-2'),
        {
          id: 'read-1',
          name: 'workspace_read',
          summary: 'workspace_read(file_paths: [1])',
          resultMeta: '1 files read',
          status: 'done',
          agent: 'Lead agent',
          rationale: 'Verify source content before drawing a conclusion.',
        },
      ]).map((tool) => tool.name)
    ).toEqual(['workspace_write', 'git_diff'])
  })

  it('closes repeated read, diff, and terminal loops until a real edit succeeds', () => {
    const params = {
      agentMode: 'debug',
      taskExpectation: 'workspace-change',
      automaticContinuation: {
        prompt: 'Continue the same crash fix without broad investigation.',
        steps: [],
      },
    } as unknown as AgentTurnParams
    const evidence = [
      ['workspace_read', 'LibraryView.swift read'],
      ['git_diff', 'LibraryView.swift scoped diff'],
      ['workspace_read', 'BarcodeScannerView.swift read'],
      ['git_diff', 'scanner files scoped diff'],
      ['workspace_search', 'Library crash'],
      ['run_terminal', 'inspect crash logs'],
      ['workspace_search', 'Library callback'],
      ['run_terminal', 'xcodebuild simulator build'],
      ['workspace_read', 'FoodItemEditor.swift read'],
      ['git_diff', 'Library files scoped diff'],
    ].map(([name, summary], index): AgentStep => ({
      id: `evidence-${index}`,
      name,
      summary,
      resultMeta: 'completed evidence',
      status: 'done',
      agent: 'Debugger',
      rationale: 'Resolve the Library crash from concrete evidence.',
    }))
    const tools = [
      { name: 'workspace_search' },
      { name: 'workspace_manifest' },
      { name: 'workspace_read' },
      { name: 'git_status' },
      { name: 'git_diff' },
      { name: 'workspace_write' },
      { name: 'workspace_create' },
      { name: 'workspace_delete' },
      { name: 'workspace_rename' },
      { name: 'run_terminal' },
      { name: 'restore_checkpoint' },
    ]

    expect(
      toolsForRound(params, tools, 0, evidence).map((tool) => tool.name)
    ).toEqual([
      'workspace_write',
      'workspace_create',
      'workspace_delete',
      'workspace_rename',
      'restore_checkpoint',
    ])
  })

  it('reopens an exact corrective mutation lane after a partial persisted pass', () => {
    const carried: AgentStep[] = [
      {
        id: 'write-1',
        name: 'workspace_write',
        summary: 'workspace_write(edits: [1])',
        resultMeta: 'file changed · persisted abcdef123456',
        status: 'done',
        agent: 'Builder',
        rationale: 'Apply the requested change.',
      },
      {
        id: 'verify-1',
        name: 'run_terminal',
        summary: 'run_terminal(command: [reviewed])',
        resultMeta: 'exit 0 · Tests passed',
        status: 'done',
        agent: 'Builder',
        rationale: 'Verify the requested change.',
      },
    ]
    const params = {
      agentMode: 'agent',
      taskExpectation: 'workspace-change',
      automaticContinuation: {
        prompt: 'Apply the remaining correction.',
        steps: carried,
        correctiveMutationRequired: true,
        correctionBoundary: carried.length,
      },
    } as unknown as AgentTurnParams
    const tools = [
      { name: 'workspace_write' },
      { name: 'workspace_read' },
      { name: 'git_diff' },
      { name: 'workspace_search' },
      { name: 'run_terminal' },
    ]

    expect(
      toolsForRound(params, tools, 0, carried).map((tool) => tool.name)
    ).toEqual(['workspace_write', 'workspace_read', 'git_diff'])

    const corrected: AgentStep[] = [
      ...carried,
      {
        id: 'read-2',
        name: 'workspace_read',
        summary: 'workspace_read(file_paths: [1])',
        resultMeta: '1 files read',
        status: 'done',
        agent: 'Builder',
        rationale: 'Read the exact correction target.',
      },
      {
        id: 'write-2',
        name: 'workspace_write',
        summary: 'workspace_write(edits: [1])',
        resultMeta: 'file changed · persisted fedcba654321',
        status: 'done',
        agent: 'Builder',
        rationale: 'Apply the remaining correction.',
      },
    ]
    expect(
      toolsForRound(params, tools, 1, corrected).map((tool) => tool.name)
    ).toEqual(['workspace_write', 'workspace_read', 'git_diff', 'run_terminal'])
  })

  it('keeps a claimed-removal lane open while an exact reread still contains the API', () => {
    const steps: AgentStep[] = [
      {
        id: 'write-font',
        name: 'workspace_write',
        summary: 'workspace_write(edits: [1])',
        resultMeta: 'file changed · persisted abcdef123456',
        status: 'done',
        agent: 'Builder',
        rationale: 'Apply semantic typography.',
        preview: { kind: 'diff', title: 'Layout.swift', after: '.font(.headline)' },
      },
      {
        id: 'read-font',
        name: 'workspace_read',
        summary: 'workspace_read(file_paths: [1])',
        resultMeta: '1 files read',
        status: 'done',
        agent: 'Builder',
        rationale: 'Confirm the exact current source.',
        preview: {
          kind: 'code',
          title: 'Layout.swift',
          body: '.font(.system(size: 11))',
        },
      },
    ]
    const params = {
      agentMode: 'agent',
      taskExpectation: 'workspace-change',
      automaticContinuation: {
        prompt: 'Correct the unsupported removal claim.',
        steps,
        requiredClaimIdentifiers: ['absent:.system(size:)'],
      },
    } as unknown as AgentTurnParams
    const tools = [
      { name: 'workspace_write' },
      { name: 'workspace_read' },
      { name: 'git_diff' },
      { name: 'run_terminal' },
    ]

    expect(
      toolsForRound(params, tools, 0, steps).map((tool) => tool.name)
    ).toEqual(['workspace_write', 'workspace_read', 'git_diff'])
  })

  it('preserves one exact recovery read after the carried review budget is exhausted', () => {
    const priorReviews = Array.from({ length: 4 }, (_, index): AgentStep => ({
      id: `review-${index}`,
      name: index % 2 === 0 ? 'workspace_read' : 'git_diff',
      summary: `scoped review ${index}`,
      resultMeta:
        index % 2 === 0 ? '1 files read' : 'scoped diff read',
      status: 'done',
      agent: 'Builder',
      rationale: 'Inspect the exact target.',
    }))
    const persisted: AgentStep = {
      id: 'write-prefix',
      name: 'workspace_write',
      summary: 'workspace_write(edits: [1])',
      resultMeta: 'file changed · persisted abcdef123456',
      status: 'done',
      agent: 'Builder',
      rationale: 'Apply the requested change.',
    }
    const failed: AgentStep = {
      id: 'write-remainder',
      name: 'workspace_write',
      summary: 'workspace_write(edits: [1])',
      resultMeta: 'failed · exact edit did not match',
      status: 'error',
      agent: 'Builder',
      rationale: 'Apply the remaining correction.',
    }
    const carried = [...priorReviews, persisted, failed]
    const params = {
      agentMode: 'agent',
      taskExpectation: 'workspace-change',
      automaticContinuation: {
        prompt: 'Apply the remaining correction.',
        steps: carried,
        correctiveMutationRequired: true,
        correctionBoundary: carried.length,
      },
    } as unknown as AgentTurnParams
    const tools = [
      { name: 'workspace_write' },
      { name: 'workspace_create' },
      { name: 'workspace_read' },
      { name: 'git_diff' },
      { name: 'workspace_search' },
      { name: 'workspace_manifest' },
      { name: 'git_status' },
      { name: 'run_terminal' },
    ]

    expect(
      toolsForRound(params, tools, 0, carried).map((tool) => tool.name)
    ).toEqual([
      'workspace_write',
      'workspace_create',
      'workspace_read',
      'git_diff',
    ])

    const reread: AgentStep = {
      id: 'recovery-read',
      name: 'workspace_read',
      summary: 'workspace_read(file_paths: [1])',
      resultMeta: '1 files read',
      status: 'done',
      agent: 'Builder',
      rationale: 'Refresh the exact correction target.',
    }
    const afterRead = [...carried, reread]
    expect(
      toolsForRound(params, tools, 1, afterRead).map((tool) => tool.name)
    ).toEqual(['workspace_write', 'workspace_create', 'git_diff'])

    const correction: AgentStep = {
      id: 'write-correction',
      name: 'workspace_write',
      summary: 'workspace_write(edits: [1])',
      resultMeta: 'file changed · persisted fedcba654321',
      status: 'done',
      agent: 'Builder',
      rationale: 'Persist the remaining correction.',
    }
    expect(
      toolsForRound(params, tools, 2, [...afterRead, correction]).map(
        (tool) => tool.name
      )
    ).toEqual([
      'workspace_write',
      'workspace_create',
      'workspace_read',
      'git_diff',
      'git_status',
      'run_terminal',
    ])
  })

  it('keeps only the exact corrective lane through a truncated large-file continuation', () => {
    const failed: AgentStep = {
      id: 'failed-later-edit',
      name: 'workspace_write',
      summary: 'workspace_write(edits: [1])',
      resultMeta: 'failed · exact edit did not match',
      status: 'error',
      agent: 'Builder',
      rationale: 'Apply the later-file correction.',
    }
    const params = {
      agentMode: 'agent',
      taskExpectation: 'workspace-change',
      automaticContinuation: {
        prompt: 'Finish the exact later-file correction.',
        steps: [failed],
        correctiveMutationRequired: true,
        correctionBoundary: 1,
      },
    } as unknown as AgentTurnParams
    const tools = [
      { name: 'workspace_write' },
      { name: 'workspace_read' },
      { name: 'git_diff' },
      { name: 'workspace_search' },
      { name: 'workspace_manifest' },
      { name: 'git_status' },
      { name: 'run_terminal' },
    ]
    const prefixRead: AgentStep = {
      id: 'prefix-read',
      name: 'workspace_read',
      summary: 'workspace_read(file_path: "Sources/Large.swift")',
      resultMeta: '1 files read · truncated · continue at line 256',
      status: 'done',
      agent: 'Builder',
      rationale: 'Read the exact correction target.',
    }
    expect(
      toolsForRound(params, tools, 1, [failed, prefixRead]).map(
        (tool) => tool.name
      )
    ).toEqual(['workspace_write', 'workspace_read', 'git_diff'])

    const rangeRead: AgentStep = {
      id: 'range-read',
      name: 'workspace_read',
      summary:
        'workspace_read(file_path: "Sources/Large.swift", start_line: 520, end_line: 775)',
      resultMeta: '1 files read · lines 520-775 of 775',
      status: 'done',
      agent: 'Builder',
      rationale: 'Read the later correction target.',
    }
    expect(
      toolsForRound(params, tools, 2, [failed, prefixRead, rangeRead]).map(
        (tool) => tool.name
      )
    ).toEqual(['workspace_write', 'git_diff'])

    const persisted: AgentStep = {
      id: 'persisted-later-edit',
      name: 'workspace_write',
      summary: 'workspace_write(edits: [1])',
      resultMeta: 'file changed · persisted abcdef123456',
      status: 'done',
      agent: 'Builder',
      rationale: 'Persist the later-file correction.',
    }
    expect(
      toolsForRound(params, tools, 3, [
        failed,
        prefixRead,
        rangeRead,
        persisted,
      ]).map((tool) => tool.name)
    ).toEqual([
      'workspace_write',
      'workspace_read',
      'git_diff',
      'git_status',
      'run_terminal',
    ])
  })
})

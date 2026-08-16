import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  DesktopTerminalSession,
  DesktopWorkspaceBinding,
  DesktopWorkspaceState,
} from '../desktop'
import { AgentDataCache, executeTool } from './tools'

const binding: DesktopWorkspaceBinding = {
  workspaceId: 'fedcba9876543210abcd',
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'window')
  Reflect.deleteProperty(globalThis, 'localStorage')
})

describe('run_terminal verification evidence', () => {
  it('fails a masked Xcode test failure even when the legacy session exits zero', async () => {
    const output = [
      'Testing failed:',
      '** TEST FAILED **',
      'A later unrelated check exited successfully.',
    ].join('\n')
    const { rootRef, startTerminal } = await terminalWorkspace(output)

    const result = await executeTool('user', workspaceCache(), 'run_terminal', {
      root_ref: rootRef,
      command: [
        'xcodebuild test -destination generic/platform=iOS',
        'git diff --check',
      ].join('\n'),
    })

    expect(result.isError).toBe(true)
    expect(result.resultMeta).toContain('verification failed')
    expect(result.resultMeta).toContain('Tests failed')
    expect(result.resultMeta).not.toContain('Build passed')
    expect(result.preview?.title).toBe('Tests failed · reported by tool output')
    expect(JSON.parse(result.content)).toMatchObject({
      exit_code: 0,
      verification_failed: true,
    })
    expect(startTerminal).toHaveBeenCalledWith(
      expect.any(String),
      '/workspace',
      'everything',
      undefined,
      { sessionId: 'session' },
      binding,
      { failClosed: true }
    )
  })

  it('keeps successful Xcode output eligible as explicit build evidence', async () => {
    const { rootRef } = await terminalWorkspace('** TEST SUCCEEDED **')

    const result = await executeTool('user', workspaceCache(), 'run_terminal', {
      root_ref: rootRef,
      command: 'xcodebuild test -destination platform=iOS Simulator,name=iPhone 17',
    })

    expect(result.isError).toBe(false)
    expect(result.resultMeta).toBe('exit 0 · Tests passed')
    expect(result.preview?.title).toBe('Tests passed')
  })

  it('distinguishes an Xcode build action from an Xcode test action', async () => {
    const { rootRef } = await terminalWorkspace('** BUILD SUCCEEDED **')

    const result = await executeTool('user', workspaceCache(), 'run_terminal', {
      root_ref: rootRef,
      command:
        'xcodebuild -project StatsKey.xcodeproj -scheme StatsKey -destination "generic/platform=iOS Simulator" build',
    })

    expect(result.isError).toBe(false)
    expect(result.resultMeta).toBe('exit 0 · Build passed')
    expect(result.preview?.title).toBe('Build passed')
  })

  it('records a standalone POSIX content assertion as change-check evidence', async () => {
    const { rootRef } = await terminalWorkspace('')

    const result = await executeTool('user', workspaceCache(), 'run_terminal', {
      root_ref: rootRef,
      command:
        'test "$(cat .statskey/device-proof/final-installed-completion.txt)" = "FINAL_INSTALLED_COMPLETION_PROOF_2026-08-13"',
    })

    expect(result.isError).toBe(false)
    expect(result.resultMeta).toBe('exit 0 · Change check passed')
    expect(result.preview?.title).toBe('Change check passed')
  })

  it('records a failed standalone POSIX assertion as failed change evidence', async () => {
    const { rootRef } = await terminalWorkspace('', {
      status: 'failed',
      exitCode: 1,
    })

    const result = await executeTool('user', workspaceCache(), 'run_terminal', {
      root_ref: rootRef,
      command: 'test -f .statskey/device-proof/missing.txt',
    })

    expect(result.isError).toBe(true)
    expect(result.resultMeta).toBe(
      'verification failed · Change check failed · reported by tool output'
    )
    expect(result.preview?.title).toBe(
      'Change check failed · reported by tool output'
    )
  })

  it.each([
    'echo test',
    'find . -name test',
    'test -f proof.txt && echo test',
    'command test -f proof.txt',
  ])('keeps non-standalone test text as generic command evidence: %s', async (command) => {
    const { rootRef } = await terminalWorkspace('')

    const result = await executeTool('user', workspaceCache(), 'run_terminal', {
      root_ref: rootRef,
      command,
    })

    expect(result.resultMeta).toBe('exit 0 · Command passed')
    expect(result.preview?.title).toBe('Command passed')
  })

  it.each(['npm test', 'npx vitest run'])(
    'keeps test runners in the test category rather than change checks: %s',
    async (command) => {
      const { rootRef } = await terminalWorkspace('')

      const result = await executeTool('user', workspaceCache(), 'run_terminal', {
        root_ref: rootRef,
        command,
      })

      expect(result.resultMeta).toBe('exit 0 · Tests passed')
      expect(result.preview?.title).toBe('Tests passed')
    }
  )

  it('records both verification kinds for a successful combined Xcode batch', async () => {
    const { rootRef } = await terminalWorkspace(
      '** TEST SUCCEEDED **\n** BUILD SUCCEEDED **'
    )

    const result = await executeTool('user', workspaceCache(), 'run_terminal', {
      root_ref: rootRef,
      command: [
        'xcodebuild -project StatsKey.xcodeproj test',
        'xcodebuild -project StatsKey.xcodeproj build',
      ].join('\n'),
    })

    expect(result.isError).toBe(false)
    expect(result.resultMeta).toBe('exit 0 · Tests passed · Build passed')
  })

  it('fails closed when the terminal exits abnormally without an exit code', async () => {
    const { rootRef } = await terminalWorkspace('Process terminated unexpectedly.', {
      status: 'failed',
      exitCode: null,
      signal: 9,
    })

    const result = await executeTool('user', workspaceCache(), 'run_terminal', {
      root_ref: rootRef,
      command: 'xcodebuild test -destination platform=iOS Simulator,name=iPhone 17',
    })

    expect(result.isError).toBe(true)
    expect(result.resultMeta).toContain('verification failed')
    expect(result.resultMeta).not.toContain('Build passed')
    expect(result.preview?.title).toBe('Tests failed · reported by tool output')
    expect(JSON.parse(result.content)).toMatchObject({
      terminal_status: 'failed',
      exit_code: null,
      signal: 9,
      verification_failed: true,
    })
  })

  it('passes discovered Android tool paths as a validated terminal environment', async () => {
    const { rootRef, startTerminal } = await terminalWorkspace('41 tests passed')
    await executeTool('user', workspaceCache(), 'run_terminal', {
      root_ref: rootRef,
      command: './gradlew :shared:test :phone:assembleDebug',
      environment: {
        JAVA_HOME: '/opt/homebrew/opt/openjdk/libexec/openjdk.jdk/Contents/Home',
        ANDROID_HOME: '/Users/test/Library/Android/sdk',
        ANDROID_SDK_ROOT: '/Users/test/Library/Android/sdk',
        'BAD-NAME': 'ignored',
        HOME: '/malicious/home',
        PATH: '/malicious/bin',
        NODE_OPTIONS: '--require=/malicious/file',
        DYLD_INSERT_LIBRARIES: '/malicious/library',
      },
    })
    expect(startTerminal).toHaveBeenLastCalledWith(
      expect.any(String),
      '/workspace',
      'everything',
      undefined,
      { sessionId: 'session' },
      binding,
      {
        failClosed: true,
        environment: {
          JAVA_HOME: '/opt/homebrew/opt/openjdk/libexec/openjdk.jdk/Contents/Home',
          ANDROID_HOME: '/Users/test/Library/Android/sdk',
          ANDROID_SDK_ROOT: '/Users/test/Library/Android/sdk',
        },
      }
    )
  })
})

function workspaceCache() {
  return new AgentDataCache(
    'user',
    { sessionId: 'session' },
    {
      agentMode: 'agent',
      approvalMode: 'everything',
      workspaceBinding: binding,
    }
  )
}

async function terminalWorkspace(
  output: string,
  overrides: Partial<DesktopTerminalSession> = {}
) {
  const root = {
    name: 'Project',
    path: '/workspace',
    relativePath: '.',
    kind: 'directory' as const,
    extension: '',
    size: null,
    modifiedAt: '2026-08-12T00:00:00.000Z',
  }
  const state: DesktopWorkspaceState = {
    workspaceId: binding.workspaceId,
    roots: [root],
    root,
    looseFiles: [],
    importedWorkspace: null,
  }
  const session: DesktopTerminalSession = {
    id: 'terminal-1',
    command: 'xcodebuild',
    cwd: '/workspace',
    rootName: 'Project',
    failClosed: true,
    status: 'exited',
    output,
    exitCode: 0,
    signal: null,
    startedAt: '2026-08-12T00:00:00.000Z',
    updatedAt: '2026-08-12T00:00:01.000Z',
    ...overrides,
  }
  const startTerminal = vi.fn(async () => ({ ok: true, session }))
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      dispatchEvent: vi.fn(),
      statsKeyDesktop: {
        setBadge: vi.fn(),
        openExternal: vi.fn(),
        workspace: {
          getState: vi.fn(async () => state),
          readFile: vi.fn(),
          startTerminal,
          onTerminalEvent: vi.fn(() => () => {}),
        },
        providers: { getStatus: vi.fn() },
        preferences: { get: vi.fn() },
        mcp: { tools: vi.fn() },
        onSummon: vi.fn(),
      },
    },
  })
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: vi.fn(() => '[]') },
  })
  const manifest = await executeTool('user', workspaceCache(), 'workspace_manifest', {})
  const rootRef = JSON.parse(manifest.content).roots[0].root_ref as string
  return { rootRef, startTerminal }
}

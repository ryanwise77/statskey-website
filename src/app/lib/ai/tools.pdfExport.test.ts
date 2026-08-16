import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  DesktopWorkspaceBinding,
  DesktopWorkspaceNode,
  DesktopWorkspaceState,
} from '../desktop'
import { AgentDataCache, executeTool } from './tools'

const binding: DesktopWorkspaceBinding = {
  workspaceId: '0123456789abcdefabcd',
}
const sha256 = 'a'.repeat(64)

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'window')
  Reflect.deleteProperty(globalThis, 'localStorage')
})

describe('export_pdf', () => {
  it('exports a verified PDF directly to the Desktop without a workspace root', async () => {
    const { exportPdf } = installDesktopBridge()

    const result = await executeTool('user', cache(), 'export_pdf', {
      destination: 'desktop',
      relative_path: 'Training report.pdf',
      title: 'Training report',
      content: '<h1>Training report</h1><p>Verified content.</p>',
    })

    expect(result.isError, result.content).toBe(false)
    expect(exportPdf).toHaveBeenCalledWith(
      'Training report.pdf',
      '<h1>Training report</h1><p>Verified content.</p>',
      'Training report',
      'everything',
      expect.anything()
    )
    const payload = JSON.parse(result.content)
    expect(payload.destination).toBe('desktop')
    expect(payload.exported_path).toBe('/Users/test/Desktop/Training report.pdf')
    expect(payload.persisted_change_verified).toBe(true)
    expect(result.resultMeta).toMatch(/^file changed · persisted [a-f0-9]{12}$/)
  })

  it('exports through the workspace renderer when a project destination is requested', async () => {
    const { renderPdf } = installDesktopBridge()
    const workspaceCache = cache()
    const manifest = await executeTool(
      'user',
      workspaceCache,
      'workspace_manifest',
      {}
    )
    expect(manifest.isError, manifest.content).toBe(false)
    const rootRef = JSON.parse(manifest.content).roots[0].root_ref

    const result = await executeTool('user', workspaceCache, 'export_pdf', {
      destination: 'workspace',
      root_ref: rootRef,
      relative_path: 'reports/weekly.pdf',
      content: '<h1>Weekly report</h1>',
    })

    expect(result.isError, result.content).toBe(false)
    expect(renderPdf).toHaveBeenCalledWith(
      '/workspace/project',
      'reports/weekly.pdf',
      '<h1>Weekly report</h1>',
      'weekly',
      'everything',
      expect.anything(),
      binding
    )
  })
})

function cache() {
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

function installDesktopBridge() {
  const root = node('/workspace/project', 'project', 'directory', '')
  const state: DesktopWorkspaceState = {
    workspaceId: binding.workspaceId,
    roots: [root],
    root,
    looseFiles: [],
    importedWorkspace: null,
  }
  const exportPdf = vi.fn(async () => ({
    ok: true,
    changed: true,
    file: node(
      '/Users/test/Desktop/Training report.pdf',
      'Training report.pdf',
      'file',
      'Training report.pdf'
    ),
    bytes: 1_024,
    sha256,
    destination: 'desktop' as const,
  }))
  const renderPdf = vi.fn(async () => ({
    ok: true,
    changed: true,
    file: node(
      '/workspace/project/reports/weekly.pdf',
      'weekly.pdf',
      'file',
      'reports/weekly.pdf'
    ),
    bytes: 2_048,
    sha256,
  }))
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
          exportPdf,
          renderPdf,
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
  return { exportPdf, renderPdf }
}

function node(
  path: string,
  name: string,
  kind: DesktopWorkspaceNode['kind'],
  relativePath: string
): DesktopWorkspaceNode {
  return {
    name,
    path,
    relativePath,
    kind,
    extension: kind === 'file' ? 'pdf' : '',
    size: kind === 'file' ? 1_024 : null,
    modifiedAt: '2026-08-15T00:00:00.000Z',
  }
}

import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  DesktopDeviceActionRequest,
  DesktopDevicesBridge,
  DesktopWorkspaceBinding,
} from '../desktop'
import { AGENT_TOOLS, AgentDataCache, executeTool } from './tools'
import { hasStructuredDeviceRunVerification } from './agentPersistence'

const binding: DesktopWorkspaceBinding = {
  workspaceId: 'device-workspace-1234',
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'window')
})

describe('secure device tools', () => {
  it('keeps device discovery read-only and returns build environment paths', async () => {
    const list = vi.fn(async () => ({
      ok: true,
      action: 'list' as const,
      marker: 'DEVICE_DISCOVERY_COMPLETE',
      devices: [
        {
          id: 'opaque-1',
          name: 'iPhone 17',
          platform: 'ios' as const,
          state: 'booted',
          available: true,
        },
      ],
      tools: {
        javaHome: '/safe/jdk',
        androidSdk: '/safe/android-sdk',
      },
      buildEnvironment: {
        JAVA_HOME: '/safe/jdk',
        ANDROID_HOME: '/safe/android-sdk',
        ANDROID_SDK_ROOT: '/safe/android-sdk',
      },
    }))
    installBridge({ list })
    const result = await executeTool('user', cache('ask'), 'device_list', {})

    expect(result.isError).toBe(false)
    expect(list).toHaveBeenCalledWith(binding, { sessionId: 'run-1' })
    expect(JSON.parse(result.content)).toMatchObject({
      marker: 'DEVICE_DISCOVERY_COMPLETE',
      tools: { javaHome: '/safe/jdk', androidSdk: '/safe/android-sdk' },
      buildEnvironment: {
        JAVA_HOME: '/safe/jdk',
        ANDROID_HOME: '/safe/android-sdk',
        ANDROID_SDK_ROOT: '/safe/android-sdk',
      },
    })
  })

  it('routes installs with the captured binding and active approval mode', async () => {
    const act = vi.fn(async (request: DesktopDeviceActionRequest) => ({
      ok: true,
      platform: request.platform,
      action: request.action,
      marker: 'DEVICE_APP_INSTALLED',
      installed: true,
    }))
    installBridge({ act })
    const result = await executeTool('user', cache('agent'), 'device_install', {
      platform: 'android',
      device_id: 'opaque-android',
      artifact_path: '/workspace/phone-debug.apk',
    })

    expect(result.isError).toBe(false)
    expect(act).toHaveBeenCalledWith(
      {
        platform: 'android',
        action: 'install',
        deviceId: 'opaque-android',
        artifactPath: '/workspace/phone-debug.apk',
      },
      'everything',
      { sessionId: 'run-1' },
      binding
    )
    expect(JSON.parse(result.content).marker).toBe('DEVICE_APP_INSTALLED')
  })

  it('routes deep links and workspace media as setup actions, never run proof', async () => {
    const act = vi.fn(async (request: DesktopDeviceActionRequest) => ({
      ok: true,
      platform: request.platform,
      action: request.action,
      marker:
        request.action === 'open_url'
          ? 'DEVICE_URL_OPENED'
          : 'DEVICE_MEDIA_ADDED',
      ...(request.action === 'open_url'
        ? { opened: true, scheme: 'statskey' }
        : { added: true, mediaType: 'image' as const, fileName: 'meal.jpg' }),
    }))
    installBridge({ act })
    const agentCache = cache('agent')
    const opened = await executeTool('user', agentCache, 'device_open_url', {
      platform: 'ios',
      device_id: 'opaque-ios',
      url: 'statskey://record?surface=library',
    })
    const added = await executeTool('user', agentCache, 'device_add_media', {
      platform: 'ios',
      device_id: 'opaque-ios',
      media_path: '/workspace/fixtures/meal.jpg',
    })

    expect(opened.isError).toBe(false)
    expect(added.isError).toBe(false)
    expect(act).toHaveBeenNthCalledWith(
      1,
      {
        platform: 'ios', action: 'open_url', deviceId: 'opaque-ios',
        url: 'statskey://record?surface=library',
      },
      'everything',
      { sessionId: 'run-1' },
      binding
    )
    expect(act).toHaveBeenNthCalledWith(
      2,
      {
        platform: 'ios', action: 'add_media', deviceId: 'opaque-ios',
        mediaPath: '/workspace/fixtures/meal.jpg',
      },
      'everything',
      { sessionId: 'run-1' },
      binding
    )
    expect(opened.resultMeta).toBe('device url opened')
    expect(added.resultMeta).toBe('device media added')
    expect(
      hasStructuredDeviceRunVerification([
        { name: 'device_open_url', status: 'done', resultMeta: opened.resultMeta },
        { name: 'device_add_media', status: 'done', resultMeta: added.resultMeta },
      ])
    ).toBe(false)
    expect(AGENT_TOOLS.find((tool) => tool.name === 'device_open_url')?.description)
      .toContain('not UI, liveness, crash-free, or completion proof')
    expect(AGENT_TOOLS.find((tool) => tool.name === 'device_add_media')?.description)
      .toContain('not UI, liveness, crash-free, or completion proof')
  })

  it('blocks device mutations in Ask mode', async () => {
    const act = vi.fn()
    installBridge({ act })
    const result = await executeTool('user', cache('ask'), 'device_tap', {
      platform: 'ios',
      device_id: 'opaque-ios',
      x: 100,
      y: 200,
    })
    expect(result.isError).toBe(true)
    expect(result.content).toContain('Ask mode is read-only')
    expect(act).not.toHaveBeenCalled()
  })

  it('blocks deep links and media injection in Ask mode', async () => {
    const act = vi.fn()
    installBridge({ act })
    const opened = await executeTool('user', cache('ask'), 'device_open_url', {
      platform: 'ios', device_id: 'opaque-ios', url: 'statskey://record',
    })
    const added = await executeTool('user', cache('ask'), 'device_add_media', {
      platform: 'ios', device_id: 'opaque-ios', media_path: '/workspace/meal.jpg',
    })
    expect(opened.isError).toBe(true)
    expect(added.isError).toBe(true)
    expect(act).not.toHaveBeenCalled()
  })

  it('does not send screenshot pixels back as model text', async () => {
    installBridge({
      act: vi.fn(async () => ({
        ok: true,
        platform: 'ios' as const,
        action: 'screenshot' as const,
        marker: 'DEVICE_SCREENSHOT_CAPTURED',
        screenshot: {
          mediaType: 'image/png' as const,
          data: 'VERY_SECRET_PIXEL_PAYLOAD',
          width: 1179,
          height: 2556,
        },
      })),
    })
    const result = await executeTool('user', cache('ask'), 'device_screenshot', {
      platform: 'ios',
      device_id: 'opaque-ios',
    })
    expect(result.isError).toBe(false)
    expect(result.content).not.toContain('VERY_SECRET_PIXEL_PAYLOAD')
    expect(JSON.parse(result.content)).toMatchObject({
      marker: 'DEVICE_SCREENSHOT_CAPTURED',
      width: 1179,
      height: 2556,
    })
  })

  it('rejects an unmarked success instead of inventing device evidence', async () => {
    installBridge({ act: vi.fn(async () => ({ ok: true })) })
    const result = await executeTool('user', cache('agent'), 'device_process', {
      platform: 'android',
      device_id: 'opaque-android',
      app_id: 'com.statskey.wear',
    })
    expect(result.isError).toBe(true)
  })

  it('treats a stopped process or crash marker as failed verification evidence', async () => {
    const act = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        platform: 'ios',
        action: 'process',
        marker: 'DEVICE_PROCESS_NOT_RUNNING',
        alive: false,
      })
      .mockResolvedValueOnce({
        ok: true,
        platform: 'ios',
        action: 'logs',
        marker: 'DEVICE_CRASH_MARKERS_FOUND',
        alive: true,
        crashFree: false,
        crashMarkers: ['fatal-error'],
      })
    installBridge({ act })
    const processResult = await executeTool(
      'user', cache('agent'), 'device_process',
      { platform: 'ios', device_id: 'opaque-ios', app_id: 'ai.statskey' }
    )
    const logsResult = await executeTool(
      'user', cache('agent'), 'device_logs',
      { platform: 'ios', device_id: 'opaque-ios', app_id: 'ai.statskey' }
    )
    expect(processResult.isError).toBe(true)
    expect(logsResult.isError).toBe(true)
    expect(processResult.resultMeta).toMatch(
      /^device proof · process · ios · d:[a-f0-9]{12} · a:[a-f0-9]{12} · not-alive$/
    )
    expect(logsResult.resultMeta).toMatch(
      /^device proof · logs · ios · d:[a-f0-9]{12} · a:[a-f0-9]{12} · crash-detected$/
    )
  })

  it('persists bounded same-device and same-app launch/log proof without raw identifiers', async () => {
    const act = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        platform: 'ios',
        action: 'launch',
        marker: 'DEVICE_APP_LAUNCHED',
        appId: 'ai.statskey.private-app',
        launched: true,
        alive: true,
      })
      .mockResolvedValueOnce({
        ok: true,
        platform: 'ios',
        action: 'logs',
        marker: 'DEVICE_LOGS_CRASH_FREE',
        appId: 'ai.statskey.private-app',
        alive: true,
        crashFree: true,
        crashMarkers: [],
      })
    installBridge({ act })
    const agentCache = cache('agent')
    const launch = await executeTool('user', agentCache, 'device_launch', {
      platform: 'ios',
      device_id: 'opaque-private-device',
      app_id: 'ai.statskey.private-app',
    })
    const logs = await executeTool('user', agentCache, 'device_logs', {
      platform: 'ios',
      device_id: 'opaque-private-device',
      app_id: 'ai.statskey.private-app',
    })

    expect(launch.isError).toBe(false)
    expect(logs.isError).toBe(false)
    const launchMatch = launch.resultMeta.match(
      /^device proof · launch · ios · d:([a-f0-9]{12}) · a:([a-f0-9]{12}) · launched$/
    )
    const logsMatch = logs.resultMeta.match(
      /^device proof · logs · ios · d:([a-f0-9]{12}) · a:([a-f0-9]{12}) · alive · crash-free$/
    )
    expect(launchMatch?.slice(1)).toEqual(logsMatch?.slice(1))
    expect(`${launch.resultMeta}\n${logs.resultMeta}`).not.toContain(
      'opaque-private-device'
    )
    expect(`${launch.resultMeta}\n${logs.resultMeta}`).not.toContain(
      'ai.statskey.private-app'
    )
    expect(
      hasStructuredDeviceRunVerification([
        { name: 'device_launch', status: 'done', resultMeta: launch.resultMeta },
        { name: 'device_logs', status: 'done', resultMeta: logs.resultMeta },
      ])
    ).toBe(true)
  })
})

function cache(mode: 'ask' | 'agent') {
  return new AgentDataCache(
    'user',
    { sessionId: 'run-1' },
    {
      agentMode: mode,
      approvalMode: 'everything',
      workspaceBinding: binding,
    }
  )
}

function installBridge(overrides: Partial<DesktopDevicesBridge>) {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      dispatchEvent: vi.fn(),
      statsKeyDesktop: {
        setBadge: vi.fn(),
        openExternal: vi.fn(),
        workspace: { readFile: vi.fn() },
        providers: { getStatus: vi.fn() },
        preferences: { get: vi.fn() },
        mcp: { tools: vi.fn() },
        onSummon: vi.fn(),
        devices: {
          list: overrides.list ?? vi.fn(),
          act: overrides.act ?? vi.fn(),
        },
      },
    },
  })
}

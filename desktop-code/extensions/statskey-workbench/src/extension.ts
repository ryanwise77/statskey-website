import * as vscode from 'vscode'
import { SessionStore, type StatsKeySession } from './session'
import { AuthManager, verifyFirebaseIdToken } from './api'
import { StatsKeyWorkbenchProvider } from './workbenchView'
import { StatsKeyHome } from './home'

const VIEW_ID = 'statskey.workbench'
const LAST_PENDING_KEY = 'statskey.lastPendingCount'

export function activate(context: vscode.ExtensionContext) {
  const sessions = new SessionStore(context.secrets, context.globalState)
  const auth = new AuthManager(sessions)
  const config = () => vscode.workspace.getConfiguration('statskey')
  const workbenchUrl = () =>
    config().get<string>('workbenchUrl', 'https://statskey.ai/app/flow') ||
    'https://statskey.ai/app/flow'
  // Authentication must never be workspace-configurable because the URL
  // receives a one-time custom token.
  const authUrl = () => 'https://statskey.ai/app/workbench-auth'

  const provider = new StatsKeyWorkbenchProvider(context.extensionUri, auth)
  const home = new StatsKeyHome(auth)

  let pollTimer: ReturnType<typeof setInterval> | undefined
  const stopPolling = () => {
    if (pollTimer) clearInterval(pollTimer)
    pollTimer = undefined
  }
  const pollOnce = async () => {
    if (!auth.current()) return
    try {
      const pending = await auth.pendingActions()
      const count = pending.length
      const last = context.globalState.get<number>(LAST_PENDING_KEY, 0)
      await context.globalState.update(LAST_PENDING_KEY, count)
      if (count > last) {
        const choice = await vscode.window.showInformationMessage(
          count === 1
            ? 'StatsKey prepared 1 thing for you to review.'
            : `StatsKey prepared ${count} things for you to review.`,
          'Review'
        )
        if (choice === 'Review') await home.show({ rail: 'actions' })
      }
    } catch {
      // offline or session lapsed; try again next tick
    }
  }
  const startPolling = () => {
    stopPolling()
    pollTimer = setInterval(() => void pollOnce(), 75_000)
    void pollOnce()
  }

  auth.onChange((session) => {
    if (session) startPolling()
    else {
      stopPolling()
      void context.globalState.update(LAST_PENDING_KEY, 0)
    }
  })

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(VIEW_ID, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.window.registerUriHandler({
      handleUri(uri: vscode.Uri) {
        void handleAuthUri(uri, sessions, auth, home)
      },
    }),
    vscode.commands.registerCommand('statskey.openWorkbench', async () => {
      await home.show()
    }),
    vscode.commands.registerCommand('statskey.openAgentBrowser', async () => {
      await openStatsKeyBrowser(auth, workbenchUrl, '/enterprise')
    }),
    vscode.commands.registerCommand('statskey.buyTokens', async () => {
      await openStatsKeyBrowser(auth, workbenchUrl, '/tokens')
    }),
    vscode.commands.registerCommand('statskey.ask', async () => {
      await home.show({ compose: '1' })
    }),
    vscode.commands.registerCommand('statskey.newAgentTask', async () => {
      await home.show({ compose: '1' })
    }),
    vscode.commands.registerCommand('statskey.reviewApprovals', async () => {
      await home.show({ rail: 'actions' })
    }),
    vscode.commands.registerCommand('statskey.signIn', async () => {
      const state = await sessions.createAuthState()
      const url = new URL(authUrl())
      url.searchParams.set('state', state)
      url.searchParams.set('protocol', 'statskey-workbench')
      url.searchParams.set('client', 'statskey-workbench')
      await vscode.env.openExternal(vscode.Uri.parse(url.toString()))
      void vscode.window.showInformationMessage(
        'Finish signing in in your browser — StatsKey will pick up right after.'
      )
    }),
    vscode.commands.registerCommand('statskey.signOut', async () => {
      const browserSignOut = await signOutStatsKeyBrowser()
      await auth.clear()
      void vscode.window.showInformationMessage(
        browserSignOut === 'closed'
          ? 'Signed out of StatsKey and closed its private agent-browser session.'
          : browserSignOut === 'navigated'
            ? 'Signed out of the desktop. The StatsKey browser is finishing sign-out; wait for its login screen.'
            : browserSignOut === 'incomplete'
              ? 'Signed out of the desktop, but the StatsKey browser did not confirm sign-out. Its tab was left open so you can finish there.'
              : 'Signed out of the desktop. Sign out separately in any open StatsKey browser tab.'
      )
    }),
    vscode.commands.registerCommand('statskey.searchIndex', async () => {
      await vscode.commands.executeCommand('workbench.view.extension.statskey')
      await provider.hydrate()
    })
  )

  void (async () => {
    try {
      await auth.load()
    } catch {
      // signed-out home still opens
    }
    if (config().get<boolean>('agentHome', true)) {
      try {
        await home.show()
      } catch {
        // the StatsKey sidebar remains available as a fallback
      }
    }
  })()
}

export function deactivate() {}

async function openStatsKeyBrowser(
  auth: AuthManager,
  getWorkbenchUrl: () => string,
  nextPath: '/enterprise' | '/tokens'
) {
  try {
    const configuredUrl = new URL(getWorkbenchUrl())
    configuredUrl.pathname = `/app${nextPath}`
    configuredUrl.search = ''
    configuredUrl.hash = ''

    let target = configuredUrl.toString()
    if (auth.current()) {
      try {
        const handoffCode = await auth.mintWebHandoffCode()
        const handoff = new URL('https://statskey.ai/app/workbench-auth')
        handoff.searchParams.set('embed', '1')
        handoff.searchParams.set('next', nextPath)
        handoff.hash = new URLSearchParams({ handoffCode }).toString()
        target = handoff.toString()
      } catch {
        // The browser can still present the normal StatsKey sign-in flow.
      }
    }

    const browserCommand = 'workbench.action.browser.open'
    const commands = await vscode.commands.getCommands(true)
    if (commands.includes(browserCommand)) {
      await vscode.commands.executeCommand(browserCommand, {
        url: target,
        openToSide: true,
        reuseUrlFilter: `${new URL(target).origin}/**`,
        storageScope: 'ephemeral',
      })
      return
    }

    await vscode.env.openExternal(vscode.Uri.parse(target))
  } catch {
    void vscode.window.showErrorMessage(
      'StatsKey could not open that page in the agent browser.'
    )
  }
}

async function signOutStatsKeyBrowser(): Promise<'closed' | 'navigated' | 'incomplete' | 'unavailable'> {
  const browserCommand = 'workbench.action.browser.open'
  const commands = await vscode.commands.getCommands(true)
  const signOutUrl = new URL('https://statskey.ai/app/workbench-auth')
  signOutUrl.searchParams.set('embed', '1')
  signOutUrl.searchParams.set('signOut', '1')

  const closeMatchingCommand = 'workbench.action.browser.closeMatching'
  if (commands.includes(closeMatchingCommand)) {
    try {
      const result = await vscode.commands.executeCommand<{
        closed: number
        failed: number
      }>(
        closeMatchingCommand,
        {
          urlFilter: 'https://statskey.ai/**',
          navigateTo: signOutUrl.toString(),
          waitForUrlFilter: 'https://statskey.ai/app/login*',
          timeoutMs: 10_000,
        }
      )
      return result?.failed === 0 ? 'closed' : 'incomplete'
    } catch {
      return 'incomplete'
    }
  }

  if (!commands.includes(browserCommand)) return 'unavailable'

  try {
    await vscode.commands.executeCommand(browserCommand, {
      url: signOutUrl.toString(),
      openToSide: true,
      reuseUrlFilter: 'https://statskey.ai/**',
      storageScope: 'ephemeral',
    })
    return 'navigated'
  } catch {
    return 'unavailable'
  }
}

async function handleAuthUri(
  uri: vscode.Uri,
  sessions: SessionStore,
  auth: AuthManager,
  home: StatsKeyHome
) {
  const params = new URLSearchParams(uri.query)
  const state = params.get('state')
  const handoff = new URLSearchParams(uri.fragment)
  const idToken = handoff.get('idToken')
  if (!state || !(await sessions.consumeAuthState(state))) {
    void vscode.window.showErrorMessage('Sign-in check failed. Start sign-in again.')
    return
  }
  if (!idToken) {
    void vscode.window.showErrorMessage('Sign-in didn’t complete. Try again.')
    return
  }
  let verified
  try {
    verified = await verifyFirebaseIdToken(idToken)
  } catch {
    void vscode.window.showErrorMessage('Sign-in token could not be verified.')
    return
  }
  const session: StatsKeySession = {
    uid: verified.uid,
    idToken,
    email: verified.email || handoff.get('email') || undefined,
    displayName:
      verified.displayName || handoff.get('displayName') || undefined,
    expiresAt: Number(handoff.get('expiresAt') || 0) || undefined,
  }
  await auth.set(session)
  await home.show()
  void vscode.window.showInformationMessage('You’re signed in to StatsKey.')
}

import * as vscode from 'vscode'
import type { AuthManager } from './api'
import type { StatsKeySession } from './session'

export class StatsKeyHome {
  private panel: vscode.WebviewPanel | undefined
  private session: StatsKeySession | undefined

  constructor(private readonly auth: AuthManager) {
    this.session = auth.current()
    auth.onChange((session) => {
      this.session = session
      if (this.panel) void this.render()
    })
  }

  async show(_params: Record<string, string> = {}) {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.One)
      await this.render()
      return
    }
    this.panel = vscode.window.createWebviewPanel(
      'statskey.home',
      'StatsKey',
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true }
    )
    this.panel.onDidDispose(() => {
      this.panel = undefined
    })
    this.panel.webview.onDidReceiveMessage((message) => {
      if (message?.type === 'signIn') void vscode.commands.executeCommand('statskey.signIn')
      if (message?.type === 'retry') void this.render()
      if (message?.type === 'openAgentBrowser') {
        void vscode.commands.executeCommand('statskey.openAgentBrowser')
      }
      if (message?.type === 'buyTokens') {
        void vscode.commands.executeCommand('statskey.buyTokens')
      }
    })
    await this.render()
  }

  private async render() {
    if (!this.panel) return
    if (!this.session) {
      this.panel.webview.html = welcomeHtml()
      return
    }
    this.panel.webview.html = connectedHtml(this.session)
  }
}

const BASE_STYLE = `
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; height: 100vh; overflow: hidden;
    background: radial-gradient(900px 500px at 20% 0%, rgba(32,185,155,.14), transparent 60%), #0b0e14;
    color: #eef2fa; font: 15px/1.55 ui-sans-serif, system-ui, -apple-system, sans-serif;
  }
  .center { height: 100vh; display: flex; align-items: center; justify-content: center; }
  .card { text-align: center; max-width: 360px; padding: 24px; }
  h1 { font-size: 26px; letter-spacing: -0.02em; margin: 0 0 10px; font-weight: 650; }
  p { color: #a7b0c2; margin: 0 0 24px; }
  button {
    background: #20b99b; color: #04140f; border: 0; border-radius: 999px;
    padding: 12px 26px; font: inherit; font-weight: 650; cursor: pointer;
  }
`

function welcomeHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>${BASE_STYLE}</style>
</head>
<body>
  <div class="center">
    <div class="card">
      <h1>StatsKey</h1>
      <p>Your health record, working for you. Sign in once to get started.</p>
      <button id="signin">Sign in</button>
    </div>
  </div>
  <script>
    const vscode = acquireVsCodeApi();
    document.getElementById('signin').addEventListener('click', () => {
      vscode.postMessage({ type: 'signIn' });
    });
  </script>
</body>
</html>`
}

function connectedHtml(session: StatsKeySession): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>${BASE_STYLE}</style>
</head>
<body>
  <div class="center">
    <div class="card">
      <h1>StatsKey</h1>
      <p>Connected as ${escapeHtml(session.email || session.displayName || session.uid)}. Open the private agent browser to work with StatsKey, preview files, or manage credits.</p>
      <button id="agent-browser">Open agent browser</button>
      <button id="credits" style="margin-top:10px;background:#18202d;color:#eef2fa">Buy or auto re-up credits</button>
    </div>
  </div>
  <script>
    (function () {
      var vscode = acquireVsCodeApi();
      document.getElementById('agent-browser').addEventListener('click', function () {
        vscode.postMessage({ type: 'openAgentBrowser' });
      });
      document.getElementById('credits').addEventListener('click', function () {
        vscode.postMessage({ type: 'buyTokens' });
      });
    })();
  </script>
</body>
</html>`
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

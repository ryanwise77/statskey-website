import * as vscode from 'vscode'
import type { AuthManager, PendingAction } from './api'
import type { StatsKeySession } from './session'

export class StatsKeyWorkbenchProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined
  private session: StatsKeySession | undefined
  private pending: PendingAction[] = []
  private searchHits: Array<Record<string, unknown>> = []
  private status = ''

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly auth: AuthManager
  ) {
    this.session = auth.current()
    auth.onChange((session) => {
      this.session = session
      if (session) void this.refreshNative()
      else {
        this.pending = []
        this.searchHits = []
        this.status = ''
        this.render()
      }
    })
  }

  async hydrate() {
    if (this.session) await this.refreshNative()
    this.render()
  }

  resolveWebviewView(webviewView: vscode.WebviewView) {
    this.view = webviewView
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    }
    webviewView.webview.onDidReceiveMessage((message) => {
      void this.onMessage(message)
    })
    void this.hydrate()
  }

  private async refreshNative() {
    if (!this.session) return
    this.status = 'Checking your record…'
    this.render()
    try {
      this.pending = await this.auth.pendingActions()
      this.status =
        this.pending.length === 0
          ? 'Connected'
          : `${this.pending.length} thing${this.pending.length === 1 ? '' : 's'} waiting for your OK`
    } catch (error) {
      this.status = error instanceof Error ? error.message : 'Could not reach StatsKey'
    }
    this.render()
  }

  private async onMessage(message: { type?: string; query?: string; actionId?: string; payloadHash?: string }) {
    switch (message.type) {
      case 'signIn':
        await vscode.commands.executeCommand('statskey.signIn')
        break
      case 'signOut':
        await vscode.commands.executeCommand('statskey.signOut')
        break
      case 'refresh':
        await this.refreshNative()
        break
      case 'openWorkbench':
        await vscode.commands.executeCommand('statskey.ask')
        break
      case 'openAgentBrowser':
        await vscode.commands.executeCommand('statskey.openAgentBrowser')
        break
      case 'buyTokens':
        await vscode.commands.executeCommand('statskey.buyTokens')
        break
      case 'search': {
        if (!this.session || !message.query?.trim()) return
        this.status = 'Searching your record…'
        this.render()
        try {
          const result = await this.auth.searchRecord(message.query.trim())
          const hits = Array.isArray(result.results)
            ? (result.results as Array<Record<string, unknown>>)
            : Array.isArray(result.hits)
              ? (result.hits as Array<Record<string, unknown>>)
              : []
          this.searchHits = hits.slice(0, 12)
          this.status =
            this.searchHits.length === 0
              ? 'Nothing found in your record'
              : `Found ${this.searchHits.length} match${this.searchHits.length === 1 ? '' : 'es'} in your record`
        } catch (error) {
          this.status = error instanceof Error ? error.message : 'Search failed'
        }
        this.render()
        break
      }
      case 'approve': {
        if (!this.session || !message.actionId || !message.payloadHash) return
        try {
          await this.auth.approve(message.actionId, message.payloadHash)
          this.status = 'Approved — StatsKey will take it from here'
          await this.refreshNative()
        } catch (error) {
          this.status = error instanceof Error ? error.message : 'Approve failed'
          this.render()
        }
        break
      }
      case 'reject': {
        if (!this.session || !message.actionId) return
        try {
          await this.auth.decline(message.actionId, 'Declined from StatsKey Workbench')
          this.status = 'Declined'
          await this.refreshNative()
        } catch (error) {
          this.status = error instanceof Error ? error.message : 'Decline failed'
          this.render()
        }
        break
      }
      default:
        break
    }
  }

  private render() {
    if (!this.view) return
    const webview = this.view.webview
    webview.html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    :root { color-scheme: dark; --bg:#0b0d12; --panel:#121621; --text:#e8ecf4; --muted:#9aa3b5; --accent:#20b99b; --line:#243043; }
    body { margin:0; font:12px/1.45 ui-sans-serif, system-ui, sans-serif; background:var(--bg); color:var(--text); }
    header { padding:12px 12px 8px; border-bottom:1px solid var(--line); }
    h1 { margin:0; font-size:13px; letter-spacing:.02em; }
    .muted { color:var(--muted); margin-top:4px; }
    .status { margin-top:8px; color:var(--accent); }
    .status:empty { display:none; }
    section { padding:10px 12px; border-bottom:1px solid var(--line); }
    .row { display:flex; gap:6px; flex-wrap:wrap; margin-top:8px; }
    button, input { font:inherit; }
    button { background:var(--panel); color:var(--text); border:1px solid var(--line); border-radius:6px; padding:6px 9px; cursor:pointer; }
    button.primary { background:var(--accent); color:#04140f; border-color:transparent; font-weight:600; }
    button.danger { color:#ffb4b4; }
    input { flex:1; min-width:120px; background:var(--panel); color:var(--text); border:1px solid var(--line); border-radius:6px; padding:6px 8px; }
    .card { background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:8px; margin-top:8px; }
    .card b { display:block; margin-bottom:4px; }
  </style>
</head>
<body>
  <header>
    <h1>StatsKey</h1>
    <div class="muted">${this.session ? escapeHtml(this.session.email || this.session.uid) : 'Not signed in'}</div>
    <div class="status">${escapeHtml(this.status)}</div>
  </header>
  <section>
    <div class="row">
      ${
        this.session
          ? `<button class="primary" data-cmd="openWorkbench">Open StatsKey</button>
             <button data-cmd="openAgentBrowser">Agent browser</button>
             <button data-cmd="buyTokens">Buy or auto re-up credits</button>
             <button data-cmd="refresh">Refresh</button>
             <button data-cmd="signOut">Sign out</button>`
          : `<button class="primary" data-cmd="signIn">Sign in</button>`
      }
    </div>
  </section>
  ${
    this.session
      ? `<section>
    <div class="row" style="margin-top:2px">
      <input id="q" placeholder="Ask about your record…" />
      <button class="primary" data-cmd="search">Search</button>
    </div>
    ${this.searchHits
      .map((hit) => {
        const title = String(hit.title || hit.sourceType || hit.id || 'From your record')
        const snippet = String(hit.snippet || hit.text || hit.summary || '')
        return `<div class="card"><b>${escapeHtml(title)}</b><div class="muted">${escapeHtml(snippet).slice(0, 280)}</div></div>`
      })
      .join('')}
  </section>
  <section>
    <h1>Waiting for your OK</h1>
    ${
      this.pending.length === 0
        ? `<div class="muted" style="margin-top:8px">Nothing waiting. When StatsKey prepares something — like sending an email or adding to your calendar — it shows up here first.</div>`
        : this.pending
            .map(
              (action) => `<div class="card">
      <b>${escapeHtml(action.summary)}</b>
      <div class="row">
        <button class="primary" data-approve="${escapeHtml(action.id)}" data-hash="${escapeHtml(action.payloadHash)}">Approve</button>
        <button class="danger" data-reject="${escapeHtml(action.id)}">Not now</button>
      </div>
    </div>`
            )
            .join('')
    }
  </section>`
      : `<section><div class="muted">Sign in once. Your record and anything waiting for your OK will show up here.</div></section>`
  }
  <script>
    const vscode = acquireVsCodeApi();
    document.addEventListener('click', (event) => {
      const t = event.target;
      if (!(t instanceof HTMLElement)) return;
      if (t.dataset.cmd) {
        if (t.dataset.cmd === 'search') {
          const q = document.getElementById('q');
          vscode.postMessage({ type: 'search', query: q && 'value' in q ? q.value : '' });
          return;
        }
        vscode.postMessage({ type: t.dataset.cmd });
      }
      if (t.dataset.approve) {
        vscode.postMessage({ type: 'approve', actionId: t.dataset.approve, payloadHash: t.dataset.hash });
      }
      if (t.dataset.reject) {
        vscode.postMessage({ type: 'reject', actionId: t.dataset.reject });
      }
    });
  </script>
</body>
</html>`
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

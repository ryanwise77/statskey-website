import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import {
  getDesktopBridge,
  type DesktopBrowserSnapshot,
  type DesktopBrowserState,
  type DesktopBrowserTab,
} from '../lib/desktop'
import {
  browserDestination,
  browserDisplayHost,
} from '../lib/desktopBrowserTabs'

const EMPTY_BROWSER_STATE: DesktopBrowserState = {
  tabs: [],
  activeTabId: null,
}

const BROWSER_START_URL = 'https://www.google.com/'

interface BrowserCapture {
  tabId: string
  dataUrl: string
}

const RESEARCH_STARTERS = [
  {
    label: 'WolframAlpha',
    detail: 'Math, physics, units, and symbolic work',
    url: 'https://www.wolframalpha.com/',
  },
  {
    label: 'Desmos',
    detail: 'Graphing calculator and functions',
    url: 'https://www.desmos.com/calculator',
  },
  {
    label: 'FRED',
    detail: 'Economic data and time series',
    url: 'https://fred.stlouisfed.org/',
  },
  {
    label: 'SEC EDGAR',
    detail: 'Company filings and disclosures',
    url: 'https://www.sec.gov/edgar/search/',
  },
  {
    label: 'TradingView',
    detail: 'Markets, charts, and watchlists',
    url: 'https://www.tradingview.com/',
  },
  {
    label: 'Google Scholar',
    detail: 'Research papers and citations',
    url: 'https://scholar.google.com/',
  },
] as const

export function Browser() {
  const bridge = getDesktopBridge()
  const addressRef = useRef<HTMLInputElement>(null)
  const [state, setState] = useState<DesktopBrowserState>(EMPTY_BROWSER_STATE)
  const [address, setAddress] = useState('')
  const [snapshot, setSnapshot] = useState<DesktopBrowserSnapshot | null>(null)
  const [capture, setCapture] = useState<BrowserCapture | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const activeTab = useMemo(
    () => state.tabs.find((tab) => tab.id === state.activeTabId) ?? null,
    [state]
  )
  const activeSnapshot =
    activeTab && snapshot?.tabId === activeTab.id ? snapshot : null
  const activeCapture =
    activeTab && capture?.tabId === activeTab.id ? capture : null

  useEffect(() => {
    if (!bridge?.browser?.list) return
    let active = true
    void bridge.browser.list().then((next) => {
      if (active) setState(next)
    })
    const unsubscribe = bridge.browser.onState((next) => {
      if (active) setState(next)
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [bridge])

  useEffect(() => {
    setAddress(activeTab?.url ?? '')
  }, [activeTab?.id, activeTab?.url])

  async function refreshState() {
    if (!bridge?.browser?.list) return
    setState(await bridge.browser.list())
  }

  async function openAddress(raw: string, newTab: boolean) {
    if (!bridge?.browser) return
    const url = browserDestination(raw)
    if (!url) {
      addressRef.current?.focus()
      return
    }
    setBusy(true)
    setError(null)
    setCapture(null)
    try {
      const result =
        !newTab && activeTab
          ? await bridge.browser.navigate(
              activeTab.id,
              { action: 'url', url },
              'everything'
            )
          : await bridge.browser.open(url, 'everything', undefined, {
              newTab: true,
            })
      if (!result.ok) {
        setError(result.error || 'The browser could not open that page.')
      } else {
        setSnapshot(result)
      }
      await refreshState()
    } catch (openError) {
      setError(
        openError instanceof Error
          ? openError.message
          : 'The browser could not open that page.'
      )
    } finally {
      setBusy(false)
    }
  }

  async function submitAddress(event: FormEvent) {
    event.preventDefault()
    await openAddress(address, false)
  }

  async function activateTab(tab: DesktopBrowserTab) {
    if (!bridge?.browser) return
    setError(null)
    const result = await bridge.browser.activate(tab.id)
    if (result.ok) {
      setSnapshot({ ...result, tabId: result.tabId ?? tab.id })
    } else {
      setError(result.error || 'That browser tab is unavailable.')
    }
    await refreshState()
  }

  function handleTabKeyDown(
    event: ReactKeyboardEvent<HTMLButtonElement>,
    tabIndex: number
  ) {
    let nextIndex: number | null = null
    if (event.key === 'ArrowLeft') {
      nextIndex = (tabIndex - 1 + state.tabs.length) % state.tabs.length
    } else if (event.key === 'ArrowRight') {
      nextIndex = (tabIndex + 1) % state.tabs.length
    } else if (event.key === 'Home') {
      nextIndex = 0
    } else if (event.key === 'End') {
      nextIndex = state.tabs.length - 1
    }
    if (nextIndex == null || nextIndex < 0) return
    event.preventDefault()
    const next = state.tabs[nextIndex]
    const control = document.getElementById(browserTabControlId(next.id))
    control?.focus()
    void activateTab(next)
  }

  async function navigateHistory(action: 'back' | 'forward' | 'reload') {
    if (!bridge?.browser || !activeTab) return
    setBusy(true)
    setError(null)
    setCapture(null)
    try {
      const result = await bridge.browser.navigate(
        activeTab.id,
        { action },
        'everything'
      )
      if (result.ok) setSnapshot(result)
      else setError(result.error || `Could not ${action} this page.`)
      await refreshState()
    } finally {
      setBusy(false)
    }
  }

  async function readPage() {
    if (!bridge?.browser || !activeTab) return
    setBusy(true)
    setError(null)
    try {
      const result = await bridge.browser.snapshot(activeTab.id)
      if (result.ok) setSnapshot(result)
      else setError(result.error || 'Could not inspect this page.')
    } finally {
      setBusy(false)
    }
  }

  async function capturePage() {
    if (!bridge?.browser || !activeTab) return
    setBusy(true)
    setError(null)
    try {
      const result = await bridge.browser.screenshot(activeTab.id)
      if (result.ok && result.data) {
        setCapture({
          tabId: result.tabId ?? activeTab.id,
          dataUrl: `data:${result.mediaType || 'image/png'};base64,${result.data}`,
        })
      } else {
        setError(result.error || 'Could not capture this page.')
      }
    } finally {
      setBusy(false)
    }
  }

  async function closeTab(tabId: string) {
    if (!bridge?.browser) return
    await bridge.browser.close(tabId)
    setSnapshot((current) => (current?.tabId === tabId ? null : current))
    setCapture((current) => (current?.tabId === tabId ? null : current))
    await refreshState()
  }

  if (!bridge?.browser?.list) {
    return (
      <section className="browser-workspace browser-workspace--unavailable">
        <h1>Browser tabs require the latest StatsKey Desktop build.</h1>
      </section>
    )
  }

  return (
    <section className="browser-workspace">
      <header className="browser-workspace__toolbar">
        <div className="browser-workspace__history">
          <button
            onClick={() => void navigateHistory('back')}
            disabled={!activeTab?.canGoBack || busy}
            aria-label="Back"
            title="Back"
          >
            ←
          </button>
          <button
            onClick={() => void navigateHistory('forward')}
            disabled={!activeTab?.canGoForward || busy}
            aria-label="Forward"
            title="Forward"
          >
            →
          </button>
          <button
            onClick={() => void navigateHistory('reload')}
            disabled={!activeTab || busy}
            aria-label="Reload"
            title="Reload"
          >
            ↻
          </button>
        </div>
        <form onSubmit={submitAddress}>
          <span aria-hidden="true">⌕</span>
          <input
            ref={addressRef}
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            placeholder="Search the web or enter an address"
            aria-label="Browser address"
          />
          <button type="submit" disabled={busy || !address.trim()}>
            Go
          </button>
        </form>
        <button
          className="browser-workspace__new"
          onClick={() => void openAddress(BROWSER_START_URL, true)}
          disabled={busy}
        >
          + New tab
        </button>
      </header>

      <div className="browser-workspace__tabs" role="tablist" aria-label="Browser tabs">
        {state.tabs.map((tab, tabIndex) => {
          const selected = tab.id === state.activeTabId
          return (
            <div
              key={tab.id}
              className={`browser-workspace__tab${selected ? ' active' : ''}`}
              role="presentation"
            >
              <button
                id={browserTabControlId(tab.id)}
                role="tab"
                aria-selected={selected}
                aria-controls="browser-workspace-tabpanel"
                tabIndex={selected ? 0 : -1}
                onClick={() => void activateTab(tab)}
                onKeyDown={(event) => handleTabKeyDown(event, tabIndex)}
                title={tab.url || ''}
              >
                <span>{tab.loading ? '◌' : '●'}</span>
                <b>{tab.title || browserDisplayHost(tab.url)}</b>
                <small>{browserDisplayHost(tab.url)}</small>
              </button>
              <button
                className="browser-workspace__tab-close"
                onClick={() => void closeTab(tab.id)}
                aria-label={`Close ${tab.title || 'browser tab'}`}
              >
                ×
              </button>
            </div>
          )
        })}
        {state.tabs.length === 0 && <span>No browser tabs open</span>}
      </div>

      {error && <div className="browser-workspace__error" role="alert">{error}</div>}

      <main
        id="browser-workspace-tabpanel"
        className="browser-workspace__content"
        role={activeTab ? 'tabpanel' : undefined}
        aria-labelledby={
          activeTab ? browserTabControlId(activeTab.id) : undefined
        }
      >
        {activeTab ? (
          <>
            <section className="browser-workspace__active-card">
              <div>
                <span>Active controlled page</span>
                <h1>{activeTab.title || browserDisplayHost(activeTab.url)}</h1>
                <code>{activeTab.url}</code>
                <p>
                  The page is open in an isolated StatsKey browser window. Intelligence
                  controls the conversation-scoped tabs it opens automatically under your
                  standing review permission, using page text and screenshots; passwords,
                  downloads, private networks, and arbitrary scripts stay blocked.
                </p>
              </div>
              <div>
                <button onClick={() => void activateTab(activeTab)}>Show page</button>
                <button onClick={() => void readPage()} disabled={busy}>Inspect</button>
                <button onClick={() => void capturePage()} disabled={busy}>Capture</button>
              </div>
            </section>

            {(activeCapture || activeSnapshot) && (
              <section className="browser-workspace__inspection">
                <header>
                  <div>
                    <span>Agent-readable page state</span>
                    <b>{activeSnapshot?.elements?.length ?? 0} visible controls</b>
                  </div>
                  <button
                    onClick={() => {
                      setSnapshot(null)
                      setCapture(null)
                    }}
                    aria-label="Close page inspection"
                  >
                    ×
                  </button>
                </header>
                {activeCapture && <img src={activeCapture.dataUrl} alt={`Capture of ${activeTab.title || activeTab.url}`} />}
                {activeSnapshot?.text && <pre>{activeSnapshot.text.slice(0, 12_000)}</pre>}
                {activeSnapshot?.elements && activeSnapshot.elements.length > 0 && (
                  <div className="browser-workspace__controls">
                    {activeSnapshot.elements.slice(0, 40).map((element) => (
                      <span key={element.ref}>
                        <b>{element.ref}</b>
                        {element.label || element.tag}
                      </span>
                    ))}
                  </div>
                )}
              </section>
            )}
          </>
        ) : (
          <section className="browser-workspace__start">
            <span className="browser-workspace__mark" aria-hidden="true">◎</span>
            <div>
              <span>Research workspace</span>
              <h1>Open evidence, tools, charts, and calculators.</h1>
              <p>
                Use browser tabs alongside files and Intelligence for math, physics,
                markets, company research, economics, and general web work.
              </p>
            </div>
            <div className="browser-workspace__starters">
              {RESEARCH_STARTERS.map((starter) => (
                <button
                  key={starter.url}
                  onClick={() => void openAddress(starter.url, true)}
                  disabled={busy}
                >
                  <b>{starter.label}</b>
                  <span>{starter.detail}</span>
                </button>
              ))}
            </div>
          </section>
        )}
      </main>
    </section>
  )
}

function browserTabControlId(tabId: string): string {
  return `browser-workspace-tab-${tabId.replace(/[^A-Za-z0-9_-]/g, '-')}`
}

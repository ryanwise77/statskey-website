import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { App } from './App'
import { AuthProvider } from './lib/auth'
import {
  currentMirrorHealth,
  currentMode,
  startFailoverController,
} from './lib/firestoreFailover'
import 'leaflet/dist/leaflet.css'
import '../style.css'
import './app.css'

const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('Missing #root element')

// The controller is inert when no emergency origin was explicitly
// provisioned. firebase.ts has already applied a persisted mirror selection at
// module initialization, before any Firestore listeners are created.
const failoverController = startFailoverController()
if (import.meta.hot) {
  import.meta.hot.dispose(() => failoverController.stop())
}

if (currentMode() === 'mirror') {
  const health = currentMirrorHealth()
  const banner = document.createElement('div')
  banner.setAttribute('role', 'status')
  banner.textContent = health?.writable
    ? 'Google is unreachable — StatsKey is using the emergency data server.'
    : 'Google is unreachable — StatsKey is using the emergency data server in read-only mode. Changes are temporarily unavailable.'
  banner.style.cssText =
    'position:fixed;top:0;left:0;right:0;z-index:9999;background:#7a4d00;color:#fff;' +
    'font:500 13px/1.4 Inter,system-ui,sans-serif;text-align:center;padding:6px 12px;'
  document.body.appendChild(banner)
  document.body.style.paddingTop = '30px'
}

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <BrowserRouter basename="/app">
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
)

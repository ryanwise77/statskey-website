import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { App } from './App'
import { AuthProvider } from './lib/auth'
import { getDesktopBridge } from './lib/desktop'
import '@fontsource/inter/300.css'
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/space-grotesk/400.css'
import '@fontsource/space-grotesk/500.css'
import '@fontsource/space-grotesk/600.css'
import '@fontsource/space-grotesk/700.css'
import '@fontsource/jetbrains-mono/400.css'
import 'leaflet/dist/leaflet.css'
import '../style.css'
import './app.css'

const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('Missing #root element')

const desktopBridge = getDesktopBridge()
if (desktopBridge) {
  document.body.classList.add('app-desktop')
  document.body.classList.add(`app-desktop-${desktopBridge.platform}`)
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

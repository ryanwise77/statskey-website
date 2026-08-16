import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { ClinicianApp } from './ClinicianApp'
import { ClinicianAuthProvider } from './ClinicianAuth'
import '../../style.css'
import './clinician.css'

const rootElement = document.getElementById('root')
if (!rootElement) throw new Error('Missing #root element')

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <BrowserRouter basename="/clinician">
      <ClinicianAuthProvider>
        <ClinicianApp />
      </ClinicianAuthProvider>
    </BrowserRouter>
  </React.StrictMode>
)

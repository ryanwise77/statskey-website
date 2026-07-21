// TEMPORARY dev harness — renders WellnessLogForm without auth for visual
// verification. Served only by `vite dev` via /wellness-form-dev.html.
import { createRoot } from 'react-dom/client'
import { AuthProvider } from './lib/auth'
import { WellnessLogForm } from './components/log/WellnessLogForm'
import '../style.css'
import './app.css'

createRoot(document.getElementById('root')!).render(
  <AuthProvider>
    <div className="mx-auto max-w-[760px] p-6">
      <div className="panel">
        <WellnessLogForm onSaved={() => alert('saved (dev harness)')} />
      </div>
    </div>
  </AuthProvider>
)

import { Component, type ReactNode } from 'react'
import '../ui-foundation.css'

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  error: Error | null
  resetKey: number
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null, resetKey: 0 }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error }
  }

  componentDidCatch(error: Error) {
    console.error('[StatsKey] render error', error)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="sk-error-boundary">
          <section role="alert">
            <h1>Something went wrong</h1>
            <p>
              This view hit a problem and stopped. Your files and conversations
              are safe — reload the view to continue.
            </p>
            <button
              type="button"
              onClick={() =>
                this.setState((state) => ({
                  error: null,
                  resetKey: state.resetKey + 1,
                }))
              }
            >
              Reload view
            </button>
          </section>
        </div>
      )
    }
    return <div key={this.state.resetKey} style={{ display: 'contents' }}>{this.props.children}</div>
  }
}

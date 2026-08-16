import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { logError, Scope } from '@/events/logger'
import ErrorBoundary from '@/components/ErrorBoundary'

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary
    onError={(error) => {
      logError(Scope.EXTENSION_PAGE, 'Popup render failed', error)
    }}
  >
    <App />
  </ErrorBoundary>
)

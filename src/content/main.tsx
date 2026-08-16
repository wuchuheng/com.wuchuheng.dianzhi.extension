import { createRoot } from 'react-dom/client'
import App from './views/App.tsx'
import contentCss from './index.css?inline'
import { log, logError, Scope } from '@/events/logger'
import ErrorBoundary from '@/components/ErrorBoundary'

const existing = document.getElementById('dianzhi-root')
existing?.remove()

const host = document.createElement('div')
host.id = 'dianzhi-root'
document.documentElement.appendChild(host)
const shadowRoot = host.attachShadow({ mode: 'open' })
const style = document.createElement('style')
style.textContent = contentCss
shadowRoot.appendChild(style)
const appRoot = document.createElement('div')
shadowRoot.appendChild(appRoot)

createRoot(appRoot).render(
  <ErrorBoundary
    onError={(error) => logError(Scope.CONTENT_SCRIPT, 'Dianzhi popover render failed', error)}
  >
    <App extensionHost={host} />
  </ErrorBoundary>
)

log(Scope.CONTENT_SCRIPT, 'Dianzhi selection assistant is ready')

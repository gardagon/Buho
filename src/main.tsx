import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { SyncProvider } from './sync/SyncContext'
import { ToastProvider } from './ui/Toast'
import './styles.css'

// Pide al navegador que no borre IndexedDB cuando ande justo de espacio.
void navigator.storage?.persist?.()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastProvider>
      <SyncProvider>
        <App />
      </SyncProvider>
    </ToastProvider>
  </StrictMode>,
)

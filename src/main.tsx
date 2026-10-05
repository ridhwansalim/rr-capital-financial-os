import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Capacitor } from '@capacitor/core'
import { CapacitorUpdater } from '@capgo/capacitor-updater'
import './index.css'

if (Capacitor.isNativePlatform()) {
  void CapacitorUpdater.notifyAppReady().catch(error => console.error('Native bundle readiness check failed', error))
}

// Remove the old persistent browser copy of the BYOK provider credential.
localStorage.removeItem('financial_os_ai_key')
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

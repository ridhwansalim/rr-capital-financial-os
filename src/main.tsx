import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'

// Remove the old persistent browser copy of the BYOK provider credential.
localStorage.removeItem('financial_os_ai_key')
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

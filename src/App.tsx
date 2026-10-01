import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { ThemeProvider } from './components/ThemeProvider'
import { AutoLockProvider } from './components/AutoLockProvider'
import ProtectedRoute from './components/ProtectedRoute'
import Layout from './components/Layout'
import ReloadPrompt from './components/ReloadPrompt'

// Screens
import Auth from './screens/Auth'
import Dashboard from './screens/Dashboard'
import Ledger from './screens/Ledger'
import Accounts from './screens/Accounts'
import Debts from './screens/Debts'
import Contacts from './screens/Contacts'
import Settings from './screens/Settings'
import OfflineQueue from './screens/OfflineQueue'
import Calendar from './screens/Calendar'
import Chittis from './screens/Chittis' // <-- NEW IMPORT

export default function App() {
  return (
    <ThemeProvider>
      <AutoLockProvider>
        <Router>
          <ReloadPrompt />
            <Routes>
              {/* Public Route */}
              <Route path="/auth" element={<Auth />} />

              {/* Protected Application Routes */}
              <Route path="/*" element={
                <ProtectedRoute>
                  <Layout>
                    <Routes>
                      <Route path="/" element={<Dashboard />} />
                      <Route path="/ledger" element={<Ledger />} />
                      <Route path="/accounts" element={<Accounts />} />
                      <Route path="/debts" element={<Debts />} />
                      <Route path="/contacts" element={<Contacts />} />
                      <Route path="/settings" element={<Settings />} />
                      <Route path="/offline" element={<OfflineQueue />} />
                      <Route path="/calendar" element={<Calendar />} />
                      
                      {/* FIRED UP THE ENGINE */}
                      <Route path="/chittis" element={<Chittis />} />
                      
                      {/* Fallback */}
                      <Route path="*" element={<Navigate to="/" replace />} />
                    </Routes>
                  </Layout>
                </ProtectedRoute>
              } />
            </Routes>
        </Router>
      </AutoLockProvider>
    </ThemeProvider>
  )
}

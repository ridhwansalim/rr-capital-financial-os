import { lazy, Suspense } from 'react'
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { ThemeProvider } from './components/ThemeProvider'
import { AutoLockProvider } from './components/AutoLockProvider'
import ProtectedRoute from './components/ProtectedRoute'
import Layout from './components/Layout'
import ReloadPrompt from './components/ReloadPrompt'

// Load only the active screen immediately; keep the established route and layout flow.
const Auth = lazy(() => import('./screens/Auth'))
const Dashboard = lazy(() => import('./screens/Dashboard'))
const Ledger = lazy(() => import('./screens/Ledger'))
const Accounts = lazy(() => import('./screens/Accounts'))
const Debts = lazy(() => import('./screens/Debts'))
const Contacts = lazy(() => import('./screens/Contacts'))
const Settings = lazy(() => import('./screens/Settings'))
const OfflineQueue = lazy(() => import('./screens/OfflineQueue'))
const Calendar = lazy(() => import('./screens/Calendar'))
const Chittis = lazy(() => import('./screens/Chittis'))
const Reports = lazy(() => import('./screens/Reports'))
const Budgets = lazy(() => import('./screens/Budgets'))
const Calculators = lazy(() => import('./screens/Calculators'))
const SavingsGoals = lazy(() => import('./screens/SavingsGoals'))
const ShoppingLists = lazy(() => import('./screens/ShoppingLists'))
const FinancialHealthScore = lazy(() => import('./screens/FinancialHealthScore'))
const FeatureRoute = lazy(() => import('./components/FeatureRoute'))

function ScreenLoading() {
  return <div className="min-h-[50vh] flex items-center justify-center text-sm text-slate-400" role="status" aria-live="polite">Loading page...</div>
}

export default function App() {
  return (
    <ThemeProvider>
      <AutoLockProvider>
        <Router>
          <ReloadPrompt />
            <Routes>
              {/* Public Route */}
              <Route path="/auth" element={<Suspense fallback={<ScreenLoading />}><Auth /></Suspense>} />

              {/* Protected Application Routes */}
              <Route path="/*" element={
                <ProtectedRoute>
                  <Layout>
                    <Suspense fallback={<ScreenLoading />}>
                    <Routes>
                      <Route path="/" element={<Dashboard />} />
                      <Route path="/ledger" element={<Ledger />} />
                      <Route path="/reports" element={<Reports />} />
                      <Route path="/budgets" element={<FeatureRoute feature="budgets"><Budgets /></FeatureRoute>} />
                      <Route path="/calculators" element={<FeatureRoute feature="calculators"><Calculators /></FeatureRoute>} />
                      <Route path="/savings-goals" element={<FeatureRoute feature="savings_goals"><SavingsGoals /></FeatureRoute>} />
                      <Route path="/shopping-lists" element={<FeatureRoute feature="shopping_lists"><ShoppingLists /></FeatureRoute>} />
                      <Route path="/financial-health" element={<FeatureRoute feature="financial_health_score"><FinancialHealthScore /></FeatureRoute>} />
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
                    </Suspense>
                  </Layout>
                </ProtectedRoute>
              } />
            </Routes>
        </Router>
      </AutoLockProvider>
    </ThemeProvider>
  )
}

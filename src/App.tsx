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
  return <div className="app-loading-state min-h-[58vh] px-6 flex items-center justify-center text-sm text-slate-400" role="status" aria-live="polite" aria-busy="true">
    <div className="w-full max-w-2xl">
      <div className="flex items-center gap-3 mb-8">
        <span className="app-loading-mark"><span /></span>
        <div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent-400">RR Capital</p><p className="mt-1 text-xs text-slate-500">Preparing your workspace</p></div>
      </div>
      <div className="h-7 w-48 rounded-lg bg-white/10 app-loading-shimmer" />
      <div className="mt-3 h-4 w-72 max-w-full rounded bg-white/5 app-loading-shimmer" />
      <div className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-3">
        {[0, 1, 2].map(item => <div key={item} className="h-24 rounded-2xl border border-white/10 bg-white/5 p-4"><div className="h-3 w-20 rounded bg-white/10 app-loading-shimmer" /><div className="mt-5 h-5 w-32 max-w-full rounded bg-white/10 app-loading-shimmer" /></div>)}
      </div>
    </div>
  </div>
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
                      <Route path="*" element={<Navigate to="/" replace state={{ routeNotice: 'That page does not exist. You are back on the Dashboard.' }} />} />
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

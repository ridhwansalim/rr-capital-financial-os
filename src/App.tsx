import { lazy, Suspense, useEffect } from 'react'
import { BrowserRouter as Router, Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { App as CapacitorApp } from '@capacitor/app'
import { Browser } from '@capacitor/browser'
import { Capacitor } from '@capacitor/core'
import { ThemeProvider } from './components/ThemeProvider'
import { AutoLockProvider } from './components/AutoLockProvider'
import ProtectedRoute from './components/ProtectedRoute'
import Layout from './components/Layout'
import ReloadPrompt from './components/ReloadPrompt'
import { AUTH_ROUTE, ROUTE_COMPONENT_LOADERS, ROUTE_REGISTRY } from './lib/routeRegistry'
import { supabase } from './lib/supabase'
import { handleAuthDeepLink } from './lib/nativeOAuthCallback'

// Load only the active screen immediately; keep the established route and layout flow.
const Auth = lazy(() => import('./screens/Auth'))
const FeatureRoute = lazy(() => import('./components/FeatureRoute'))
const ROUTE_COMPONENTS = Object.fromEntries(Object.entries(ROUTE_COMPONENT_LOADERS).map(([path, loader]) => [path, lazy(loader)]))

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

function LiquidToggleFilters() {
  return (
    <svg aria-hidden="true" className="liquid-toggle-filters" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <filter id="liquid-goo">
          <feGaussianBlur in="SourceGraphic" stdDeviation="1.5" result="blur" />
          <feColorMatrix in="blur" type="matrix" values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 16 -10" result="goo" />
          <feComposite in="goo" operator="atop" />
        </filter>
        <filter id="liquid-remove-black" colorInterpolationFilters="sRGB">
          <feColorMatrix type="matrix" values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 -255 -255 -255 0 1" result="black-pixels" />
          <feMorphology in="black-pixels" operator="dilate" radius="0.5" result="smoothed" />
          <feComposite in="SourceGraphic" in2="smoothed" operator="out" />
        </filter>
      </defs>
    </svg>
  )
}

function OAuthDeepLinkHandler() {
  const navigate = useNavigate()

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return
    let disposed = false
    const dependencies = {
      closeBrowser: () => Browser.close(),
      setSession: (tokens: { access_token: string; refresh_token: string }) => supabase.auth.setSession(tokens),
      exchangeCode: (code: string) => supabase.auth.exchangeCodeForSession(code),
      onStarted: () => window.dispatchEvent(new CustomEvent('rr-native-auth-started')),
      onComplete: (detail: { success: boolean; error?: string }) => {
        window.dispatchEvent(new CustomEvent('rr-native-auth-complete', { detail }))
        if (detail.success && !disposed) navigate('/', { replace: true })
        if (!detail.success && !disposed) navigate('/auth?oauth_error=1', { replace: true })
      },
    }

    const listener = CapacitorApp.addListener('appUrlOpen', ({ url }) => { void handleAuthDeepLink(url, dependencies) })
    void CapacitorApp.getLaunchUrl().then(result => {
      if (result?.url) void handleAuthDeepLink(result.url, dependencies)
    }).catch(() => undefined)
    return () => { disposed = true; void listener.then(handle => handle.remove()) }
  }, [navigate])

  return null
}

export default function App() {
  return (
    <ThemeProvider>
      <AutoLockProvider>
        <LiquidToggleFilters />
        <Router>
          <OAuthDeepLinkHandler />
          <ReloadPrompt />
            <Routes>
              {/* Public Route */}
              <Route path={AUTH_ROUTE.path} element={<Suspense fallback={<ScreenLoading />}><Auth /></Suspense>} />
              <Route path="/auth/callback" element={<Suspense fallback={<ScreenLoading />}><Auth /></Suspense>} />

              {/* Protected Application Routes */}
              <Route path="/*" element={
                <ProtectedRoute>
                  <Layout>
                    <Suspense fallback={<ScreenLoading />}>
                    <Routes>
                      {ROUTE_REGISTRY.map(route => {
                        const Screen = ROUTE_COMPONENTS[route.path]
                        const screen = <Screen />
                        return <Route key={route.path} path={route.path} element={route.optionalFeature
                          ? <FeatureRoute feature={route.optionalFeature}>{screen}</FeatureRoute>
                          : screen} />
                      })}
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

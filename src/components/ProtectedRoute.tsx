import React, { useEffect, useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { supabase } from '../lib/supabase'

export default function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null)
  const location = useLocation()

  useEffect(() => {
    // Check active session on mount
    supabase.auth.getSession().then(({ data: { session } }) => {
      setIsAuthenticated(!!session)
    })

    // Listen for auth changes (e.g., token expiration or logout)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setIsAuthenticated(!!session)
    })

    return () => {
      subscription.unsubscribe()
    }
  }, [])

  // Offline sync touches IndexedDB and the network. Load it only after the
  // protected app has confirmed a signed-in session, keeping the public auth
  // page's initial bundle and startup work smaller.
  useEffect(() => {
    if (!isAuthenticated) return
    void import('../lib/sync').catch(error => {
      console.error('Could not start offline transaction sync:', error)
    })
  }, [isAuthenticated])

  if (isAuthenticated === null) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-emerald-500 animate-spin" />
      </div>
    )
  }

  if (!isAuthenticated) {
    // Redirect to auth, saving the attempted URL so we can bounce them back after login if needed
    return <Navigate to="/auth" state={{ from: location }} replace />
  }

  return <>{children}</>
}

import React from 'react'
import { Navigate } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { useOptionalFeatures, type OptionalFeature } from '../lib/optionalFeatures'

export default function FeatureRoute({ feature, children }: { feature: OptionalFeature; children: React.ReactNode }) {
  const { flags, loading } = useOptionalFeatures()
  if (loading) return <div className="min-h-[50vh] flex items-center justify-center text-slate-400" role="status"><Loader2 className="w-6 h-6 animate-spin" /></div>
  if (!flags[feature]) return <Navigate to="/" replace />
  return <>{children}</>
}

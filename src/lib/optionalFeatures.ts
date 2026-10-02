import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { createUserFeatureFlagCache } from './featureFlagCache'

export type OptionalFeature = 'budgets' | 'savings_goals' | 'shopping_lists' | 'calculators' | 'financial_health_score' | 'account_health'
export type FeatureFlags = Partial<Record<OptionalFeature, boolean>>

// Layout and Settings are mounted together. Share the short-lived read between
// their hooks while keeping forced refreshes and account switches race-safe.
const featureCache = createUserFeatureFlagCache<FeatureFlags>(async userId => {
  const { data, error } = await supabase.from('user_feature_flags').select('feature_key, enabled')
  const { data: { session }, error: sessionError } = await supabase.auth.getSession()
  if (sessionError) throw sessionError
  // Do not cache a response under the previous owner if the active session
  // changed while the request was in flight.
  if (session?.user.id !== userId) return null
  if (error) throw error
  return Object.fromEntries((data || []).map(row => [row.feature_key, row.enabled])) as FeatureFlags
})

async function fetchFeatureFlags(force = false): Promise<FeatureFlags> {
  const { data: { session } } = await supabase.auth.getSession()
  const userId = session?.user.id
  if (!userId) return {}
  return await featureCache.read(userId, force) || {}
}

export function useOptionalFeatures() {
  const [flags, setFlags] = useState<FeatureFlags>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    let requestRevision = 0
    const load = async (force = false) => {
      const revision = ++requestRevision
      try {
        const nextFlags = await fetchFeatureFlags(force)
        if (!active || revision !== requestRevision) return
        setFlags(nextFlags)
      } catch (error) {
        console.warn('Could not load optional feature settings:', error)
        if (active && revision === requestRevision) setFlags({})
      } finally {
        if (active && revision === requestRevision) setLoading(false)
      }
    }
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED') {
        // Invalidate already-started reads immediately so they cannot restore
        // a previous account's navigation state after this auth event.
        requestRevision += 1
        setFlags({})
        setLoading(Boolean(session?.user.id))
        if (session?.user.id) featureCache.invalidate(session.user.id)
        else featureCache.invalidate()
        window.setTimeout(() => { void load(true) }, 0)
      }
    })
    const onChange = () => { featureCache.invalidate(); void load(true) }
    window.addEventListener('rr:features-changed', onChange)
    void load()
    return () => { active = false; requestRevision += 1; subscription.unsubscribe(); window.removeEventListener('rr:features-changed', onChange) }
  }, [])

  return { flags, loading }
}

export async function setOptionalFeature(feature: OptionalFeature, enabled: boolean) {
  const { data: existing, error: readError } = await supabase.from('user_feature_flags')
    .select('feature_key').eq('feature_key', feature).maybeSingle()
  if (readError) throw readError
  const result = existing
    ? await supabase.from('user_feature_flags').update({ enabled }).eq('feature_key', feature)
    : await supabase.from('user_feature_flags').insert({ feature_key: feature, enabled })
  if (result.error) throw result.error
  window.dispatchEvent(new Event('rr:features-changed'))
}

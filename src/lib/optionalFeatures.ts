import { useEffect, useState } from 'react'
import { supabase } from './supabase'

export type OptionalFeature = 'budgets' | 'savings_goals' | 'shopping_lists' | 'calculators' | 'financial_health_score' | 'account_health'
export type FeatureFlags = Partial<Record<OptionalFeature, boolean>>

export function useOptionalFeatures() {
  const [flags, setFlags] = useState<FeatureFlags>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    const load = async () => {
      setLoading(true)
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        if (active) { setFlags({}); setLoading(false) }
        return
      }
      const { data, error } = await supabase.from('user_feature_flags').select('feature_key, enabled')
      if (!active) return
      // Fail closed: a missing table/network response never enables a module.
      setFlags(error ? {} : Object.fromEntries((data || []).map(row => [row.feature_key, row.enabled])) as FeatureFlags)
      setLoading(false)
    }
    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => { window.setTimeout(() => { void load() }, 0) })
    const onChange = () => { void load() }
    window.addEventListener('rr:features-changed', onChange)
    void load()
    return () => { active = false; subscription.unsubscribe(); window.removeEventListener('rr:features-changed', onChange) }
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

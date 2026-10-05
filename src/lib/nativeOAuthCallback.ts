export type NativeOAuthResult = {
  success: boolean
  error?: string
}

export type NativeOAuthDependencies = {
  closeBrowser: () => Promise<unknown>
  setSession: (tokens: { access_token: string; refresh_token: string }) => Promise<{ error: unknown | null }>
  exchangeCode: (code: string) => Promise<{ error: unknown | null }>
  onStarted?: () => void
  onComplete: (result: NativeOAuthResult) => void
}

// The same return intent can be delivered on cold start and app resume.
const processedAuthUrls = new Set<string>()

export async function handleAuthDeepLink(rawUrl: string, dependencies: NativeOAuthDependencies): Promise<void> {
  if (!rawUrl || !rawUrl.includes('auth/callback') || processedAuthUrls.has(rawUrl)) return
  processedAuthUrls.add(rawUrl)
  dependencies.onStarted?.()

  try {
    await dependencies.closeBrowser().catch(() => undefined)

    // Android may deliver either scheme://auth/callback or scheme:///auth/callback.
    // Read query and fragment directly, without relying on URL host/path parsing.
    const queryIndex = rawUrl.indexOf('?')
    const hashIndex = rawUrl.indexOf('#')
    const queryString = queryIndex >= 0
      ? rawUrl.slice(queryIndex + 1, hashIndex > queryIndex ? hashIndex : undefined)
      : ''
    const hashString = hashIndex >= 0 ? rawUrl.slice(hashIndex + 1) : ''
    const queryParams = new URLSearchParams(queryString)
    const hashParams = new URLSearchParams(hashString)

    const errorDescription = queryParams.get('error_description') || hashParams.get('error_description')
    if (errorDescription) throw new Error(errorDescription)

    const access_token = hashParams.get('access_token') || queryParams.get('access_token')
    const refresh_token = hashParams.get('refresh_token') || queryParams.get('refresh_token')
    const code = queryParams.get('code') || hashParams.get('code')
    if (access_token && refresh_token) {
      const { error } = await dependencies.setSession({ access_token, refresh_token })
      if (error) throw error
    } else if (code) {
      const { error } = await dependencies.exchangeCode(code)
      if (error) throw error
    } else {
      throw new Error('No authorization code or session tokens found in callback URL.')
    }

    dependencies.onComplete({ success: true })
  } catch (error) {
    processedAuthUrls.delete(rawUrl)
    dependencies.onComplete({
      success: false,
      error: error instanceof Error ? error.message : 'OAuth sign-in failed.',
    })
  }
}

export function resetProcessedAuthUrlsForTests(): void {
  processedAuthUrls.clear()
}

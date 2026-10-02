export type UserFeatureFlags = Record<string, boolean>

type CachedFlags<T> = { flags: T; expiresAt: number }

export function createUserFeatureFlagCache<T extends UserFeatureFlags>(
  loadForUser: (userId: string) => Promise<T | null>,
  ttlMs = 30_000,
  now: () => number = Date.now
) {
  const cache = new Map<string, CachedFlags<T>>()
  const requests = new Map<string, Promise<T | null>>()

  return {
    async read(userId: string, force = false): Promise<T | null> {
      const cached = cache.get(userId)
      if (!force && cached && cached.expiresAt > now()) return cached.flags

      const pending = requests.get(userId)
      if (!force && pending) return pending

      let request: Promise<T | null>
      request = Promise.resolve()
        .then(() => loadForUser(userId))
        .then(flags => {
          // A forced refresh supersedes any older in-flight request. The older
          // response must not replace the cache with stale values when it ends.
          if (flags && requests.get(userId) === request) {
            cache.set(userId, { flags, expiresAt: now() + ttlMs })
          }
          return flags
        })
        .finally(() => {
          if (requests.get(userId) === request) requests.delete(userId)
        })
      requests.set(userId, request)
      return request
    },
    invalidate(userId?: string) {
      if (userId) cache.delete(userId)
      else cache.clear()
    }
  }
}

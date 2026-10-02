import { isRrCapitalUrl } from "./project.ts"
import { invokePersonalSummary } from "./rpc.ts"
import { createPerrySummaryHandler } from "./handler.ts"

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? ""
const supabaseApiKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? ""
const endpointReady = isRrCapitalUrl(supabaseUrl) && supabaseApiKey.length > 0

const handler = createPerrySummaryHandler({
  endpointReady,
  authenticateUser: async (accessToken) => {
    const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: {
        apikey: supabaseApiKey,
        authorization: `Bearer ${accessToken}`,
      },
      signal: AbortSignal.timeout(5000),
    })
    if (response.status === 401 || response.status === 403) return null
    if (!response.ok) throw new Error(`Supabase Auth verification failed: ${response.status}`)
    const user: unknown = await response.json()
    if (typeof user !== "object" || user === null || !("id" in user) || typeof user.id !== "string") return null
    return { id: user.id }
  },
  queryPersonalSummary: (accessToken) => invokePersonalSummary(supabaseUrl, supabaseApiKey, accessToken),
})

Deno.serve(handler)

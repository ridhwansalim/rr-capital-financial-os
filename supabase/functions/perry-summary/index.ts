import { Pool } from "@db/postgres"
import { createPersonalSummarySql, isRrCapitalUrl, isScopedPoolerUrl } from "./connection.ts"
import { createPerrySummaryHandler } from "./handler.ts"

const databaseUrl = Deno.env.get("PERRY_DATABASE_URL") ?? ""
const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? ""
const supabaseApiKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? ""
const databaseReady = isScopedPoolerUrl(databaseUrl) && isRrCapitalUrl(supabaseUrl) && supabaseApiKey.length > 0
const pool = databaseReady ? new Pool(databaseUrl, 1, true) : null

const handler = createPerrySummaryHandler({
  databaseReady,
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
  queryPersonalSummary: async (verifiedUserId) => {
    if (!pool) throw new Error("Perry database connection is not configured")
    const connection = await pool.connect()
    try {
      const result = await connection.queryObject<{ personal_summary: unknown }>(
        createPersonalSummarySql(verifiedUserId),
      )
      return { data: result.rows[0]?.personal_summary, error: null }
    } finally {
      connection.release()
    }
  },
})

Deno.serve(handler)

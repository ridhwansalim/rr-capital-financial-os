type Dependencies = {
  endpointReady: boolean
  authenticateUser(accessToken: string): Promise<{ id: string } | null>
  queryPersonalSummary(accessToken: string): Promise<{ data: unknown; error: { code?: string } | null }>
}

const allowedOrigins = new Set([
  "https://financial-os-orcin-ten.vercel.app",
  "http://localhost:5173",
])
const ledgerFields = [
  "completed_personal_transaction_count",
  "completed_personal_income_total",
  "completed_personal_expense_total",
  "completed_personal_transfer_total",
  "first_completed_at",
  "last_completed_at",
] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isTimestamp(value: unknown, nullable = false): value is string | null {
  return nullable && value === null || typeof value === "string" && Number.isFinite(Date.parse(value))
}

function projectSummary(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value) || !isTimestamp(value.as_of) || !Array.isArray(value.accounts) || !isRecord(value.ledger)) {
    return null
  }
  if (value.accounts.length > 100) return null

  const accounts: Array<{ name: string; type: string; personal_balance: number }> = []
  for (const account of value.accounts) {
    if (!isRecord(account) || typeof account.name !== "string" || account.name.length > 120 ||
        typeof account.type !== "string" || account.type.length > 40 ||
        typeof account.personal_balance !== "number" || !Number.isFinite(account.personal_balance)) {
      return null
    }
    accounts.push({ name: account.name, type: account.type, personal_balance: account.personal_balance })
  }

  const ledger = value.ledger
  const count = ledger.completed_personal_transaction_count
  if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0 ||
      !isTimestamp(ledger.first_completed_at, true) || !isTimestamp(ledger.last_completed_at, true)) {
    return null
  }
  const totals: Record<string, number | string | null> = {
    completed_personal_transaction_count: count,
    first_completed_at: ledger.first_completed_at,
    last_completed_at: ledger.last_completed_at,
  }
  for (const field of ledgerFields.slice(1, 4)) {
    const amount = ledger[field]
    if (typeof amount !== "number" || !Number.isFinite(amount)) return null
    totals[field] = amount
  }

  return {
    as_of: value.as_of,
    accounts,
    ledger: Object.fromEntries(ledgerFields.map(field => [field, totals[field]])),
  }
}

function response(body: unknown, status: number, origin: string | null): Response {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store, private",
    "Vary": "Origin",
    "X-Content-Type-Options": "nosniff",
  })
  if (origin && allowedOrigins.has(origin)) headers.set("Access-Control-Allow-Origin", origin)
  return new Response(JSON.stringify(body), { status, headers })
}

export function createPerrySummaryHandler(dependencies: Dependencies) {
  return async (req: Request): Promise<Response> => {
    const origin = req.headers.get("origin")
    if (origin && !allowedOrigins.has(origin)) return response({ error: "Origin not allowed" }, 403, null)
    if (req.method === "OPTIONS") {
      if (origin) {
        const headers = new Headers({
          "Access-Control-Allow-Origin": origin,
          "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Max-Age": "86400",
          "Vary": "Origin",
        })
        return new Response(null, { status: 204, headers })
      }
      return new Response(null, { status: 204 })
    }
    if (req.method !== "POST") return response({ error: "Method not allowed" }, 405, origin)
    if (new URL(req.url).search !== "") {
      return response({ error: "This endpoint accepts no query parameters" }, 400, origin)
    }
    if (req.body !== null || (req.headers.get("content-length") ?? "0") !== "0") {
      await req.body?.cancel().catch(() => undefined)
      return response({ error: "This endpoint accepts no request body" }, 400, origin)
    }

    const authorization = req.headers.get("authorization") ?? ""
    const bearer = /^Bearer ([A-Za-z0-9._~-]{20,4096})$/.exec(authorization)
    if (!bearer) return response({ error: "Authentication required" }, 401, origin)
    if (!dependencies.endpointReady) {
      return response({ error: "Endpoint is not configured" }, 503, origin)
    }

    try {
      // Verify the short-lived access token with Supabase Auth. The ID used for
      // the database auth context comes only from this verified response.
      const user = await dependencies.authenticateUser(bearer[1])
      if (!user || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(user.id)) {
        return response({ error: "Authentication required" }, 401, origin)
      }
      // Forward the verified user's short-lived token to one fixed PostgREST
      // RPC. PostgREST derives auth.uid() from that token; Perry supplies no
      // user ID and never receives a database credential or service key. The
      // database checks auth.uid() against its private Ridhu owner pin.
      const { data, error } = await dependencies.queryPersonalSummary(bearer[1])
      if (error?.code === "42501") return response({ error: "Access denied" }, 403, origin)
      const safeSummary = projectSummary(data)
      if (error || !safeSummary) {
        console.error("Personal summary request failed", error?.code ?? "invalid_response")
        return response({ error: "Summary unavailable" }, 502, origin)
      }
      return response(safeSummary, 200, origin)
    } catch (error) {
      console.error("Personal summary broker failed", error instanceof Error ? error.name : "unknown_error")
      return response({ error: "Summary unavailable" }, 503, origin)
    }
  }
}

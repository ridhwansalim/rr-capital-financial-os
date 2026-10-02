import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { readBoundedJson } from "../_shared/boundedJson.ts"

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { autoRefreshToken: false, persistSession: false },
})
const allowedOrigins = new Set(["https://financial-os-orcin-ten.vercel.app", "http://localhost:5173"])

function headersFor(origin: string | null): HeadersInit {
  const headers: Record<string, string> = { "Vary": "Origin" }
  if (origin && allowedOrigins.has(origin)) {
    headers["Access-Control-Allow-Origin"] = origin
    headers["Access-Control-Allow-Headers"] = "authorization, apikey, content-type, x-client-info"
    headers["Access-Control-Allow-Methods"] = "POST, OPTIONS"
    headers["Access-Control-Max-Age"] = "86400"
  }
  return headers
}

function respond(body: unknown, status: number, headers: HeadersInit): Response {
  return Response.json(body, { status, headers })
}

serve(async (req) => {
  const origin = req.headers.get("origin")
  const headers = headersFor(origin)
  if (req.method === "OPTIONS") {
    if (origin && !allowedOrigins.has(origin)) return new Response(null, { status: 403, headers })
    return new Response(null, { status: 204, headers })
  }
  if (req.method !== "POST") return respond({ error: "Method not allowed" }, 405, headers)
  if (origin && !allowedOrigins.has(origin)) return respond({ error: "Origin not allowed" }, 403, headers)

  const match = /^Bearer\s+([\x21-\x7e]+)$/i.exec(req.headers.get("authorization") || "")
  if (!match) return respond({ error: "Sign in to manage your Gemini key." }, 401, headers)
  const { data: { user }, error: authError } = await supabase.auth.getUser(match[1])
  if (authError || !user) return respond({ error: "Sign in to manage your Gemini key." }, 401, headers)

  const parsed = await readBoundedJson(req, 2048)
  if (!parsed.ok) {
    return respond({ error: parsed.status === 413 ? "Request is too large." : "Invalid request." }, parsed.status, headers)
  }
  if (!parsed.value || typeof parsed.value !== "object" || Array.isArray(parsed.value)) {
    return respond({ error: "Invalid request." }, 400, headers)
  }
  const payload = parsed.value as { action?: unknown; apiKey?: unknown }

  if (payload.action === "status") {
    const { data, error } = await supabase.rpc("has_user_gemini_key", { p_user_id: user.id })
    if (error) return respond({ error: "Could not check Gemini key status." }, 503, headers)
    return respond({ configured: data === true }, 200, headers)
  }

  if (payload.action === "save") {
    if (typeof payload.apiKey !== "string" || !/^AIza[\w-]{16,252}$/.test(payload.apiKey)) {
      return respond({ error: "Enter a valid-looking Google Gemini API key." }, 400, headers)
    }
    const { data, error } = await supabase.rpc("save_user_gemini_key", {
      p_user_id: user.id,
      p_secret: payload.apiKey,
    })
    if (error || data !== true) return respond({ error: "Could not securely save your Gemini key." }, 503, headers)
    return respond({ configured: true }, 200, headers)
  }

  if (payload.action === "delete") {
    const { data, error } = await supabase.rpc("delete_user_gemini_key", { p_user_id: user.id })
    if (error || data !== true) return respond({ error: "Could not remove your Gemini key." }, 503, headers)
    return respond({ configured: false }, 200, headers)
  }

  return respond({ error: "Unsupported action." }, 400, headers)
})

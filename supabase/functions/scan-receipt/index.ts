import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const supabaseUrl = Deno.env.get("SUPABASE_URL")!
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const maxImageBytes = 8 * 1024 * 1024
const allowedMimeTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"])
const allowedOrigins = new Set([
  "https://financial-os-orcin-ten.vercel.app",
  "http://localhost:5173",
])

function corsHeaders(origin: string | null): HeadersInit {
  const headers: Record<string, string> = { "Vary": "Origin" }
  if (origin && allowedOrigins.has(origin)) {
    headers["Access-Control-Allow-Origin"] = origin
    headers["Access-Control-Allow-Headers"] = "authorization, apikey, content-type, x-client-info"
    headers["Access-Control-Allow-Methods"] = "POST, OPTIONS"
    headers["Access-Control-Max-Age"] = "86400"
  }
  return headers
}

function jsonResponse(body: unknown, status: number, headers: HeadersInit): Response {
  return Response.json(body, { status, headers })
}

serve(async (req) => {
  const origin = req.headers.get("origin")
  const headers = corsHeaders(origin)

  if (req.method === "OPTIONS") {
    if (origin && !allowedOrigins.has(origin)) return new Response(null, { status: 403, headers })
    return new Response(null, { status: 204, headers })
  }
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405, headers)
  if (origin && !allowedOrigins.has(origin)) return jsonResponse({ error: "Origin not allowed" }, 403, headers)

  const authorization = req.headers.get("authorization") || ""
  const bearer = /^Bearer\s+([\x21-\x7e]+)$/i.exec(authorization)
  if (!bearer) return jsonResponse({ error: "Sign in to scan a receipt." }, 401, headers)

  // Validate the caller with Supabase Auth even though this route has no gateway JWT requirement.
  // This also lets browser preflight requests reach the explicit CORS handler above.
  const { data: { user }, error: authError } = await supabase.auth.getUser(bearer[1])
  if (authError || !user) return jsonResponse({ error: "Sign in to scan a receipt." }, 401, headers)

  // Each account supplies its own Gemini BYOK value in its owner-only profile.
  // Resolve it with the service role only after validating the caller; never
  // return the secret to the browser or include it in logs.
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("ai_api_key")
    .eq("id", user.id)
    .single()
  const geminiApiKey = profile?.ai_api_key
  if (profileError || typeof geminiApiKey !== "string" || !geminiApiKey.trim()) {
    return jsonResponse({ error: "Add your Gemini API key in Settings to scan receipts." }, 409, headers)
  }

  const contentLength = Number(req.headers.get("content-length") || 0)
  if (contentLength > 11_500_000) return jsonResponse({ error: "Receipt image is too large." }, 413, headers)

  let payload: { mimeType?: unknown; imageBase64?: unknown }
  try {
    const raw = await req.text()
    if (new TextEncoder().encode(raw).byteLength > 11_500_000) {
      return jsonResponse({ error: "Receipt image is too large." }, 413, headers)
    }
    payload = JSON.parse(raw)
  } catch {
    return jsonResponse({ error: "Invalid request." }, 400, headers)
  }

  if (typeof payload.mimeType !== "string" || !allowedMimeTypes.has(payload.mimeType) ||
      typeof payload.imageBase64 !== "string" ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(payload.imageBase64)) {
    return jsonResponse({ error: "Choose a supported receipt image." }, 400, headers)
  }

  const padding = payload.imageBase64.endsWith("==") ? 2 : payload.imageBase64.endsWith("=") ? 1 : 0
  const imageBytes = Math.floor(payload.imageBase64.length * 3 / 4) - padding
  if (imageBytes < 1 || imageBytes > maxImageBytes) {
    return jsonResponse({ error: "Receipt image must be smaller than 8 MB." }, 413, headers)
  }

  const { data: allowed, error: quotaError } = await supabase.rpc("consume_receipt_scan_quota", {
    p_user_id: user.id,
  })
  if (quotaError) {
    console.error("Receipt scan quota check failed", quotaError.code || "unknown")
    return jsonResponse({ error: "Receipt scanning is temporarily unavailable." }, 503, headers)
  }
  if (allowed !== true) return jsonResponse({ error: "Scan limit reached. Try again in a minute." }, 429, headers)

  const prompt = "Read this receipt or invoice and extract the final total paid, a short 2-4 word vendor or purchase description, and transaction type. Use expense for purchases and income only for money received or a refund. Return the total as a number in the receipt's currency, rounded to two decimals. Do not guess: if the final total is not legible, return amount 0. Return only the requested JSON fields."

  try {
    const geminiResponse = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": geminiApiKey.trim() },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: payload.mimeType, data: payload.imageBase64 } }] }],
          generationConfig: { responseMimeType: "application/json", maxOutputTokens: 128 },
        }),
        signal: AbortSignal.timeout(25_000),
      },
    )

    if (!geminiResponse.ok) {
      console.error("Gemini receipt scan failed", geminiResponse.status)
      return jsonResponse({ error: geminiResponse.status === 429
        ? "Receipt scanning is busy. Try again shortly."
        : "Receipt scanning failed. Please try again." }, geminiResponse.status === 429 ? 429 : 502, headers)
    }

    const result = await geminiResponse.json()
    const responseText = result?.candidates?.[0]?.content?.parts
      ?.map((part: { text?: unknown }) => typeof part.text === "string" ? part.text : "")
      .join("")
    if (typeof responseText !== "string") return jsonResponse({ error: "Receipt details could not be read." }, 422, headers)

    let extracted: { amount?: unknown; description?: unknown; type?: unknown }
    try {
      extracted = JSON.parse(responseText)
    } catch {
      return jsonResponse({ error: "Receipt details could not be read." }, 422, headers)
    }

    const amount = typeof extracted.amount === "number" ? Math.round(extracted.amount * 100) / 100 : 0
    const description = typeof extracted.description === "string" ? extracted.description.trim().slice(0, 120) : ""
    const type = extracted.type === "income" ? "income" : extracted.type === "expense" ? "expense" : null
    if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000_000_000 || !description || !type) {
      return jsonResponse({ error: "The receipt total could not be read. Enter it manually or try a clearer image." }, 422, headers)
    }

    return jsonResponse({ amount, description, type }, 200, headers)
  } catch (error) {
    console.error("Receipt scan request failed", error instanceof DOMException && error.name === "TimeoutError" ? "timeout" : "network")
    return jsonResponse({ error: "Receipt scanning failed. Please try again." }, 502, headers)
  }
})

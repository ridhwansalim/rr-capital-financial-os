import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const supabaseUrl = Deno.env.get("SUPABASE_URL")!
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const telegramBotToken = Deno.env.get("TELEGRAM_BOT_TOKEN")!
const webhookSecret = Deno.env.get("FINANCIAL_OS_WEBHOOK_SECRET")

const supabase = createClient(supabaseUrl, supabaseServiceKey)
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function secretsMatch(expected: string, supplied: string): boolean {
  const encoder = new TextEncoder()
  const expectedBytes = encoder.encode(expected)
  const suppliedBytes = encoder.encode(supplied)
  if (expectedBytes.length !== suppliedBytes.length) return false

  let difference = 0
  for (let i = 0; i < expectedBytes.length; i++) {
    difference |= expectedBytes[i] ^ suppliedBytes[i]
  }
  return difference === 0
}

serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 })
  if (!webhookSecret) {
    console.error("Financial OS webhook secret is not configured")
    return new Response("Webhook is not configured", { status: 503 })
  }

  const suppliedSecret = req.headers.get("x-financial-os-webhook-secret") || ""
  if (!secretsMatch(webhookSecret, suppliedSecret)) {
    return new Response("Unauthorized", { status: 401 })
  }

  let payload: any
  try {
    payload = await req.json()
  } catch {
    return new Response("Invalid JSON", { status: 400 })
  }

  const alertTables = ["obligations", "recurring_emis", "settlements"]
  if (!alertTables.includes(payload?.table) || payload?.type !== "INSERT" || payload?.record?.status !== "PENDING_APPROVAL") {
    return new Response(null, { status: 204 })
  }

  const record = payload.record
  const receiverId = record.receiver_profile_id
  if (typeof receiverId !== "string" || !uuidPattern.test(receiverId)) {
    return new Response("Invalid request event", { status: 400 })
  }

  try {
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("telegram_chat_id")
      .eq("id", receiverId)
      .maybeSingle()

    if (profileError) {
      console.error("Notification profile lookup failed", profileError.code || "unknown")
      return new Response("Profile lookup failed", { status: 502 })
    }

    if (!profile?.telegram_chat_id) return new Response(null, { status: 204 })

    const message = "A new request is waiting in RR Capital. Open the app to review it."
    const telegramResponse = await fetch(`https://api.telegram.org/bot${telegramBotToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: profile.telegram_chat_id, text: message })
    })

    if (!telegramResponse.ok) {
      console.error("Telegram notification failed", telegramResponse.status)
      return new Response("Notification delivery failed", { status: 502 })
    }

    return new Response("OK", { status: 200 })
  } catch {
    console.error("Financial OS notification handler failed")
    return new Response("Notification handler failed", { status: 500 })
  }
})

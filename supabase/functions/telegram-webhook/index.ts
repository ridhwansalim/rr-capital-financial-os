import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const supabaseUrl = Deno.env.get("SUPABASE_URL")!
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const telegramBotToken = Deno.env.get("TELEGRAM_BOT_TOKEN")!
const webhookSecret = Deno.env.get("TELEGRAM_WEBHOOK_SECRET")
const supabase = createClient(supabaseUrl, supabaseServiceKey)

function equalSecret(actual: string | null, expected: string): boolean {
  if (actual === null) return false
  const left = new TextEncoder().encode(actual)
  const right = new TextEncoder().encode(expected)
  let difference = left.length ^ right.length
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    difference |= (left[i] || 0) ^ (right[i] || 0)
  }
  return difference === 0
}

serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })
  // setWebhook must use this same secret_token. A missing deployment secret
  // fails closed instead of trusting arbitrary requests to a public endpoint.
  if (!webhookSecret || webhookSecret.length < 32) {
    return new Response('Webhook unavailable', { status: 503 })
  }
  if (!equalSecret(req.headers.get('X-Telegram-Bot-Api-Secret-Token'), webhookSecret)) {
    return new Response('Forbidden', { status: 403 })
  }
  if (Number(req.headers.get('content-length') || 0) > 1_000_000) {
    return new Response('Payload too large', { status: 413 })
  }

  try {
    const update = await req.json()
    const message = update?.message
    const chatId = message?.chat?.id
    if (message?.chat?.type !== 'private' || message?.from?.id !== chatId ||
        !Number.isSafeInteger(chatId) || chatId <= 0) {
      return new Response('OK', { status: 200 })
    }
    const match = typeof message.text === 'string'
      ? /^\/start ([0-9a-f]{48})$/.exec(message.text.trim())
      : null
    if (!match) return new Response('OK', { status: 200 })

    const { data: linked, error } = await supabase.rpc('consume_telegram_link_token', {
      p_token: match[1],
      p_chat_id: String(chatId)
    })
    if (error) {
      console.error('Telegram link failed', error.code)
      return new Response('Error', { status: 500 })
    }
    if (linked) {
      const response = await fetch(`https://api.telegram.org/bot${telegramBotToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: 'Your Telegram chat is now linked to RR Capital.'
        })
      })
      if (!response.ok) console.error('Telegram confirmation failed', response.status)
    }
    return new Response('OK', { status: 200 })
  } catch (error) {
    console.error('Telegram webhook failed', error)
    return new Response('Error', { status: 500 })
  }
})

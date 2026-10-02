import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { readBoundedJson } from "../_shared/boundedJson.ts"

const supabaseUrl = Deno.env.get("SUPABASE_URL")!
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const telegramBotToken = Deno.env.get("TELEGRAM_BOT_TOKEN")!
const webhookSecret = Deno.env.get("TELEGRAM_WEBHOOK_SECRET")
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!
const supabase = createClient(supabaseUrl, supabaseServiceKey)
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

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

async function sendTelegramMessage(chatId: number, text: string): Promise<boolean> {
  try {
    const response = await fetch(`https://api.telegram.org/bot${telegramBotToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text })
    })
    const result = await response.json().catch(() => null)
    if (!response.ok || result?.ok !== true) {
      console.error('Telegram message delivery failed', response.status, result?.error_code)
      return false
    }
    return true
  } catch (error) {
    console.error('Telegram message request failed', error instanceof Error ? error.name : 'unknown error')
    return false
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders })

  const authorization = req.headers.get('authorization') || ''
  const bearer = /^Bearer\s+([\x21-\x7e]+)$/i.exec(authorization)
  const isTelegramUpdate = !authorization && !!webhookSecret &&
    equalSecret(req.headers.get('X-Telegram-Bot-Api-Secret-Token'), webhookSecret)
  if (!isTelegramUpdate) {
    if (!bearer || !anonKey) return new Response('Sign in required', { status: 401, headers: corsHeaders })
    const authClient = createClient(supabaseUrl, anonKey)
    const { data: { user }, error: authError } = await authClient.auth.getUser(bearer[1])
    if (authError || !user) return new Response('Sign in required', { status: 401, headers: corsHeaders })
  }

  const parsed = await readBoundedJson(req, isTelegramUpdate ? 1_000_000 : 2_048)
  if (!parsed.ok) {
    return new Response(parsed.status === 413 ? 'Payload too large' : 'Invalid request', {
      status: parsed.status,
      headers: corsHeaders,
    })
  }
  const update: any = parsed.value

  // Authenticated setup repairs Telegram's remote webhook registration without
  // ever returning or exposing either server-side credential to the browser.
  if (update?.action === 'configure') {
    if (isTelegramUpdate) return new Response('Sign in required', { status: 401, headers: corsHeaders })
    if (!telegramBotToken || !webhookSecret || webhookSecret.length < 32) {
      return Response.json({ error: 'Telegram server configuration is incomplete.' }, { status: 503, headers: corsHeaders })
    }

    try {
      const webhookUrl = `${supabaseUrl}/functions/v1/telegram-webhook`
      const configured = await fetch(`https://api.telegram.org/bot${telegramBotToken}/setWebhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: webhookUrl, secret_token: webhookSecret, allowed_updates: ['message'], drop_pending_updates: false }),
      })
      const result = await configured.json()
      if (!configured.ok || result?.ok !== true) {
        console.error('Telegram webhook setup failed', configured.status, result?.error_code)
        return Response.json({ error: 'Telegram could not register the bot webhook. Try again or contact support.' }, { status: 502, headers: corsHeaders })
      }

      const verification = await fetch(`https://api.telegram.org/bot${telegramBotToken}/getWebhookInfo`)
      const info = await verification.json()
      if (!verification.ok || info?.ok !== true || info?.result?.url !== webhookUrl) {
        console.error('Telegram webhook verification failed', verification.status, info?.error_code)
        return Response.json({ error: 'Telegram accepted setup but the webhook could not be verified. Please retry.' }, { status: 502, headers: corsHeaders })
      }
      return Response.json({
        configured: true,
        webhookReady: true,
        pendingUpdates: Number.isSafeInteger(info.result.pending_update_count) ? info.result.pending_update_count : 0,
        hasDeliveryError: Number.isSafeInteger(info.result.last_error_date)
      }, { headers: corsHeaders })
    } catch (error) {
      console.error('Telegram webhook setup request failed', error instanceof Error ? error.name : 'unknown error')
      return Response.json({ error: 'Could not reach Telegram to configure the bot. Check your connection and retry.' }, { status: 502, headers: corsHeaders })
    }
  }

  // setWebhook must use this same secret_token. A missing deployment secret
  // fails closed instead of trusting arbitrary requests to a public endpoint.
  if (!webhookSecret || webhookSecret.length < 32) {
    return new Response('Webhook unavailable', { status: 503 })
  }
  if (!isTelegramUpdate) {
    return new Response('Forbidden', { status: 403 })
  }

  try {
    const message = update?.message
    const chatId = message?.chat?.id
    if (message?.chat?.type !== 'private' || message?.from?.id !== chatId ||
        !Number.isSafeInteger(chatId) || chatId <= 0) {
      return new Response('OK', { status: 200 })
    }
    const messageText = typeof message.text === 'string' ? message.text.trim() : ''
    if (!messageText.startsWith('/start')) return new Response('OK', { status: 200 })
    const match = /^\/start ([0-9a-f]{48})$/.exec(messageText)
    if (!match) {
      const delivered = await sendTelegramMessage(chatId, 'To link this chat, open RR Capital Settings, tap Link Telegram, then use the fresh Start button before the code expires.')
      return new Response(delivered ? 'OK' : 'Retry', { status: delivered ? 200 : 500, headers: corsHeaders })
    }

    const { data: linked, error } = await supabase.rpc('consume_telegram_link_token', {
      p_token: match[1],
      p_chat_id: String(chatId)
    })
    if (error) {
      console.error('Telegram link failed', error.code)
      return new Response('Error', { status: 500 })
    }
    const delivered = await sendTelegramMessage(
      chatId,
      linked
        ? 'Your Telegram chat is now linked to RR Capital.'
        : 'That RR Capital link code is invalid, expired, or already used. Go back to Settings and create a new link.'
    )
    // Once a valid token is consumed, a send failure must not retry the update:
    // the Settings page confirms the committed link by reading the profile.
    if (!linked && !delivered) return new Response('Retry', { status: 500, headers: corsHeaders })
    return new Response('OK', { status: 200, headers: corsHeaders })
  } catch (error) {
    console.error('Telegram webhook failed', error)
    return new Response('Error', { status: 500, headers: corsHeaders })
  }
})

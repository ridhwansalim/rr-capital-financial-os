import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

// These are automatically injected by Supabase when deployed
const supabaseUrl = Deno.env.get("SUPABASE_URL")!
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const telegramBotToken = Deno.env.get("TELEGRAM_BOT_TOKEN")!

const supabase = createClient(supabaseUrl, supabaseServiceKey)

serve(async (req) => {
  try {
    // Only accept POST requests from Telegram
    if (req.method !== 'POST') return new Response('OK', { status: 200 })

    const update = await req.json()
    
    // Check if the update contains a text message
    if (update.message && update.message.text) {
      const chatId = update.message.chat.id
      const text = update.message.text

      // Look for our specific Deep Link payload: "/start YOUR_USER_ID"
      if (text.startsWith('/start ')) {
        const userId = text.split(' ')[1]

        if (userId) {
          // 1. Save the Telegram Chat ID to the user's secure profile
          const { error } = await supabase
            .from('profiles')
            .update({ telegram_chat_id: chatId.toString() })
            .eq('id', userId)

          if (!error) {
            // 2. Send a confirmation message back to the user on Telegram
            const replyUrl = `https://api.telegram.org/bot${telegramBotToken}/sendMessage`
            await fetch(replyUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: chatId,
                text: "✅ Authentication successful! Your Telegram account is now securely linked to your Financial OS ledger. You will receive 2-way handshake alerts here."
              })
            })
          }
        }
      }
    }

    return new Response("OK", { status: 200 })
  } catch (error) {
    console.error("Webhook error:", error)
    return new Response("Error", { status: 500 })
  }
})
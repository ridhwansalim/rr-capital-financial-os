import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const supabaseUrl = Deno.env.get("SUPABASE_URL")!
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const telegramBotToken = Deno.env.get("TELEGRAM_BOT_TOKEN")!

const supabase = createClient(supabaseUrl, supabaseServiceKey)

serve(async (req) => {
  try {
    console.log("1. Webhook woke up! Receiving request...");
    const payload = await req.json();
    console.log("2. Payload received:", JSON.stringify(payload));

    const record = payload.record;

    if (payload.type === 'INSERT' && record.status === 'PENDING') {
      console.log(`3. Valid PENDING transaction detected for receiver: ${record.receiver_profile_id}`);

      // Lookup the receiver's Telegram ID
      const { data: profile, error: profError } = await supabase
        .from('profiles')
        .select('telegram_chat_id, full_name')
        .eq('id', record.receiver_profile_id)
        .single();

      if (profError) {
        console.error("4. ERROR fetching profile from Supabase:", profError);
        return new Response("Profile error", { status: 200 });
      }

      console.log("5. Profile found in database:", JSON.stringify(profile));

      if (profile && profile.telegram_chat_id) {
        console.log(`6. ATTEMPTING to send Telegram message to chat ID: ${profile.telegram_chat_id}`);
        
        const message = `🔔 *New Pending Handshake*\n\nYou have an incoming transfer of *₹${Number(record.amount).toFixed(2)}*.\n📝 Note: ${record.description}\n\nOpen Financial OS to accept and deposit the funds.`;

        const replyUrl = `https://api.telegram.org/bot${telegramBotToken}/sendMessage`;
        
        const tgResponse = await fetch(replyUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: profile.telegram_chat_id,
            text: message,
            parse_mode: 'Markdown'
          })
        });

        const tgResult = await tgResponse.json();
        console.log("7. TELEGRAM API RESPONSE:", JSON.stringify(tgResult));

      } else {
        console.error("6. STOPPING: The user's profile does not have a telegram_chat_id linked!");
      }
    } else {
      console.log("3. IGNORED: Not an INSERT or not PENDING.");
    }
    
    return new Response("OK", { status: 200 });
  } catch (error) {
    console.error("CRITICAL CRASH:", error);
    return new Response("Error", { status: 500 });
  }
})
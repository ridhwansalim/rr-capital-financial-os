package com.rrcapital.finance;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.provider.Telephony;
import android.telephony.SmsMessage;

public final class SmsReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) {
        if (!Telephony.Sms.Intents.SMS_RECEIVED_ACTION.equals(intent.getAction())) return;
        if (!ParsedCandidateStore.enabled(context, "sms")) return;
        SmsMessage[] messages = Telephony.Sms.Intents.getMessagesFromIntent(intent);
        if (messages == null || messages.length == 0) return;
        StringBuilder body = new StringBuilder();
        for (SmsMessage sms : messages) if (sms != null && sms.getMessageBody() != null) body.append(sms.getMessageBody());
        if (body.length() == 0) return;
        SmsMessage first = messages[0];
        long timestamp = first != null && first.getTimestampMillis() > 0 ? first.getTimestampMillis() : System.currentTimeMillis();
        TransactionParserShared.ParsedTransaction parsed = TransactionParserShared.parse(
            "sms", body.toString(), first == null ? "" : first.getOriginatingAddress(), timestamp
        );
        ParsedCandidateStore.add(context, parsed);
    }
}

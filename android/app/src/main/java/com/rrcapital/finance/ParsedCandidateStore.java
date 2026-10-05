package com.rrcapital.finance;

import android.content.Context;
import android.content.SharedPreferences;
import org.json.JSONArray;
import org.json.JSONObject;

final class ParsedCandidateStore {
    private static final String PREFS = "rr_message_candidates_v1";
    private static final String KEY = "candidates";
    private ParsedCandidateStore() {}

    static boolean enabled(Context context, String source) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getBoolean(source.equals("sms") ? "sms_capture_enabled" : "notification_capture_enabled", false);
    }

    static synchronized void add(Context context, TransactionParserShared.ParsedTransaction candidate) {
        if (candidate == null) return;
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        JSONArray stored;
        try { stored = new JSONArray(prefs.getString(KEY, "[]")); } catch (Exception ignored) { stored = new JSONArray(); }
        for (int i = 0; i < stored.length(); i++) if (candidate.id.equals(stored.optJSONObject(i).optString("id"))) return;
        JSONObject item = new JSONObject();
        try {
            item.put("id", candidate.id); item.put("amount", candidate.amount); item.put("direction", candidate.direction);
            item.put("transactionType", candidate.transactionType); item.put("description", candidate.description);
            item.put("bank", candidate.bank); item.put("accountSuffix", candidate.accountSuffix);
            item.put("source", candidate.source); item.put("receivedAt", candidate.receivedAt);
            stored.put(item);
            while (stored.length() > 50) {
                JSONArray trimmed = new JSONArray();
                for (int i = stored.length() - 49; i < stored.length(); i++) trimmed.put(stored.get(i));
                stored = trimmed;
            }
            prefs.edit().putString(KEY, stored.toString()).apply();
            NotificationHelper.updateOngoing(context, stored.length());
        } catch (Exception ignored) { }
    }

    static synchronized JSONArray list(Context context) {
        try { return new JSONArray(context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, "[]")); }
        catch (Exception ignored) { return new JSONArray(); }
    }

    static synchronized void dismiss(Context context, String id) {
        JSONArray values = list(context), remaining = new JSONArray();
        for (int i = 0; i < values.length(); i++) {
            JSONObject item = values.optJSONObject(i);
            if (item != null && !id.equals(item.optString("id"))) remaining.put(item);
        }
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, remaining.toString()).apply();
        NotificationHelper.updateOngoing(context, remaining.length());
    }
}

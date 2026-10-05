package com.rrcapital.finance;

import android.content.Context;
import android.content.SharedPreferences;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Receives the signed-in owner's compact dashboard snapshot and refreshes installed widgets. */
@CapacitorPlugin(name = "DashboardWidget")
public final class DashboardWidgetPlugin extends Plugin {
    static final String PREFS = "rr_dashboard_widget_v1";

    @PluginMethod
    public void syncSummary(PluginCall call) {
        try {
            SharedPreferences.Editor editor = getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit();
            boolean signedIn = call.getBoolean("signedIn", false);
            editor.putBoolean("signed_in", signedIn);
            if (signedIn) {
                editor.putString("net_worth", call.getString("netWorth", "—"));
                editor.putString("safe_leftover", call.getString("safeLeftover", "—"));
                editor.putString("net_flow_30_day", call.getString("netFlow30Day", "—"));
                editor.putString("next_due_name", call.getString("nextDueName", "No upcoming due"));
                editor.putString("next_due_date", call.getString("nextDueDate", ""));
                editor.putString("next_due_amount", call.getString("nextDueAmount", ""));
            } else {
                editor.remove("net_worth").remove("safe_leftover").remove("net_flow_30_day")
                    .remove("next_due_name").remove("next_due_date").remove("next_due_amount");
            }
            editor.putLong("updated_at", System.currentTimeMillis()).apply();
            QuickGlanceWidgetProvider.refresh(getContext());
            QuickActionsWidgetProvider.refresh(getContext());
            call.resolve(new JSObject().put("updated", true));
        } catch (RuntimeException error) {
            call.reject("Could not refresh RR Capital home-screen widgets.", error);
        }
    }
}

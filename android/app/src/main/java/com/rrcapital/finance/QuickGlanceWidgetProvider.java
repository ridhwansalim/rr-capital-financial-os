package com.rrcapital.finance;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.widget.RemoteViews;

/** Compact 2x2 summary of net worth and this month's remaining liquid balance. */
public final class QuickGlanceWidgetProvider extends AppWidgetProvider {
    @Override public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        for (int id : ids) manager.updateAppWidget(id, createViews(context, id));
    }

    public static void refresh(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        int[] ids = manager.getAppWidgetIds(new ComponentName(context, QuickGlanceWidgetProvider.class));
        if (ids.length > 0) new QuickGlanceWidgetProvider().onUpdate(context, manager, ids);
    }

    private RemoteViews createViews(Context context, int id) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_quick_glance);
        android.content.SharedPreferences summary = context.getSharedPreferences(DashboardWidgetPlugin.PREFS, Context.MODE_PRIVATE);
        boolean signedIn = summary.getBoolean("signed_in", false);
        views.setTextViewText(R.id.glance_net_worth, signedIn ? summary.getString("net_worth", "—") : "Sign in to view");
        views.setTextViewText(R.id.glance_safe_leftover, signedIn ? summary.getString("safe_leftover", "—") : "—");
        views.setOnClickPendingIntent(R.id.widget_quick_glance_root, dashboardIntent(context, id));
        return views;
    }

    private PendingIntent dashboardIntent(Context context, int id) {
        Intent intent = new Intent(context, MainActivity.class)
            .setAction("com.rrcapital.finance.WIDGET_QUICK_GLANCE")
            .setData(android.net.Uri.parse("com.rrcapital.financialos://action/dashboard"))
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(context, id * 10 + 1, intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
}

package com.rrcapital.finance;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.widget.RemoteViews;

/** 4x2 Cash Flow & Quick Add widget. */
public final class QuickActionsWidgetProvider extends AppWidgetProvider {
    @Override public void onUpdate(Context context, AppWidgetManager manager, int[] appWidgetIds) {
        for (int widgetId : appWidgetIds) manager.updateAppWidget(widgetId, createViews(context, widgetId));
    }

    public static void refresh(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        ComponentName provider = new ComponentName(context, QuickActionsWidgetProvider.class);
        int[] ids = manager.getAppWidgetIds(provider);
        if (ids.length > 0) new QuickActionsWidgetProvider().onUpdate(context, manager, ids);
    }

    private RemoteViews createViews(Context context, int widgetId) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_expanded);
        android.content.SharedPreferences summary = context.getSharedPreferences(DashboardWidgetPlugin.PREFS, Context.MODE_PRIVATE);
        boolean signedIn = summary.getBoolean("signed_in", false);
        views.setImageViewResource(R.id.widget_logo, R.mipmap.ic_launcher);
        views.setTextViewText(R.id.widget_net_worth, signedIn ? summary.getString("net_worth", "—") : "Sign in to view");
        views.setTextViewText(R.id.widget_net_flow, signedIn ? summary.getString("net_flow_30_day", "—") : "—");
        String dueName = signedIn ? summary.getString("next_due_name", "No upcoming due") : "Sign in to view commitments";
        String dueDate = signedIn ? summary.getString("next_due_date", "") : "";
        String dueAmount = signedIn ? summary.getString("next_due_amount", "") : "";
        views.setTextViewText(R.id.widget_next_due_name, dueName);
        views.setTextViewText(R.id.widget_next_due_detail,
            dueDate.isEmpty() ? dueAmount : dueAmount.isEmpty() ? dueDate : dueDate + "  ·  " + dueAmount);
        views.setOnClickPendingIntent(R.id.widget_expanded_root, pendingIntent(context, widgetId, "dashboard", "dashboard"));
        views.setOnClickPendingIntent(R.id.widget_expense, pendingIntent(context, widgetId, "expense", "add-transaction"));
        views.setOnClickPendingIntent(R.id.widget_split, pendingIntent(context, widgetId, "split", "split-bill"));
        return views;
    }

    private PendingIntent pendingIntent(Context context, int widgetId, String action, String path) {
        return makePendingIntent(context, widgetId, action, path);
    }

    private static PendingIntent makePendingIntent(Context context, int widgetId, String action, String path) {
        Intent intent = new Intent(context, MainActivity.class).setAction("com.rrcapital.finance.WIDGET_" + action.toUpperCase());
        intent.setData(Uri.parse("com.rrcapital.financialos://action/" + path));
        intent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(context, widgetId * 10 + action.hashCode(), intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
}

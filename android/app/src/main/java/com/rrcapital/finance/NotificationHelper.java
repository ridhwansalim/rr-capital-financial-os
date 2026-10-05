package com.rrcapital.finance;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

/** Posts one privacy-preserving, ongoing notification while local candidates await review. */
final class NotificationHelper {
    private static final String CHANNEL_ID = "transaction_review";
    private static final int NOTIFICATION_ID = 4317;
    private static final String OPEN_PENDING = "openPending";

    private NotificationHelper() {}

    static void updateOngoing(Context context, int pendingCount) {
        NotificationManagerCompat manager = NotificationManagerCompat.from(context);
        boolean enabled = context.getSharedPreferences("rr_message_candidates_v1", Context.MODE_PRIVATE)
            .getBoolean("review_notifications_enabled", false);
        if (pendingCount <= 0 || !enabled) {
            manager.cancel(NOTIFICATION_ID);
            return;
        }
        if (Build.VERSION.SDK_INT >= 33 && context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return;
        ensureChannel(context);
        Intent intent = new Intent(context, MainActivity.class)
            .setAction(Intent.ACTION_VIEW)
            .setData(Uri.parse("com.rrcapital.financialos://app/pending-transactions"))
            .putExtra(OPEN_PENDING, true)
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent contentIntent = PendingIntent.getActivity(context, NOTIFICATION_ID, intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        android.app.Notification notification = new NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_transaction)
            .setContentTitle("Categorize this transaction")
            .setContentText(pendingCount == 1 ? "Review a detected bank transaction" : "Review " + pendingCount + " detected bank transactions")
            .setContentIntent(contentIntent)
            .setCategory(android.app.Notification.CATEGORY_STATUS)
            .setOnlyAlertOnce(true)
            .setOngoing(true)
            .setAutoCancel(false)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build();
        try { manager.notify(NOTIFICATION_ID, notification); }
        catch (SecurityException ignored) { /* The Android 13+ permission may have been revoked in Settings. */ }
    }

    private static void ensureChannel(Context context) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null || manager.getNotificationChannel(CHANNEL_ID) != null) return;
        manager.createNotificationChannel(new NotificationChannel(CHANNEL_ID,
            "Transaction review", NotificationManager.IMPORTANCE_LOW));
    }
}

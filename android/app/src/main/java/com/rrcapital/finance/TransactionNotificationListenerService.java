package com.rrcapital.finance;

import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;
import android.app.Notification;
import android.os.Bundle;

public final class TransactionNotificationListenerService extends NotificationListenerService {
    @Override public void onNotificationPosted(StatusBarNotification sbn) {
        if (!ParsedCandidateStore.enabled(this, "notification")) return;
        if (sbn == null || sbn.getNotification() == null) return;
        if (getPackageName().equals(sbn.getPackageName())) return;
        Bundle extras = sbn.getNotification().extras;
        if (extras == null) return;
        CharSequence title = extras.getCharSequence(Notification.EXTRA_TITLE);
        CharSequence text = extras.getCharSequence(Notification.EXTRA_BIG_TEXT);
        if (text == null) text = extras.getCharSequence(Notification.EXTRA_TEXT);
        if (text == null) return;
        // Do not retain notification text or app names; only normalized candidates are stored locally.
        ParsedCandidateStore.add(this, TransactionParserShared.parse("notification", String.valueOf(text), String.valueOf(title == null ? "" : title), sbn.getPostTime()));
    }
}

package com.rrcapital.finance;

import android.Manifest;
import android.content.Intent;
import android.os.Build;
import android.provider.Settings;
import android.text.TextUtils;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import org.json.JSONArray;

@CapacitorPlugin(name = "MessagingIntake", permissions = {
    @Permission(alias = "sms", strings = { Manifest.permission.READ_SMS, Manifest.permission.RECEIVE_SMS }),
    @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS })
})
public final class MessagingIntakePlugin extends Plugin {
    @PluginMethod public void requestSmsPermissions(PluginCall call) { requestPermissionForAlias("sms", call, "smsPermissionsResult"); }
    @PermissionCallback private void smsPermissionsResult(PluginCall call) {
        JSObject result = new JSObject(); result.put("granted", getPermissionState("sms") == PermissionState.GRANTED); call.resolve(result);
    }
    @PluginMethod public void checkSmsPermissions(PluginCall call) {
        JSObject result = new JSObject(); result.put("granted", getPermissionState("sms") == PermissionState.GRANTED);
        result.put("enabled", getContext().getSharedPreferences("rr_message_candidates_v1", 0).getBoolean("sms_capture_enabled", false)); call.resolve(result);
    }
    @PluginMethod public void setSmsCaptureEnabled(PluginCall call) {
        boolean enabled = call.getBoolean("enabled", false);
        if (enabled && getPermissionState("sms") != PermissionState.GRANTED) { call.reject("SMS permission is not granted."); return; }
        getContext().getSharedPreferences("rr_message_candidates_v1", 0).edit().putBoolean("sms_capture_enabled", enabled).apply(); call.resolve();
    }
    @PluginMethod public void openNotificationAccessSettings(PluginCall call) {
        getActivity().startActivity(new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)); call.resolve();
    }
    @PluginMethod public void requestNotificationPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT < 33) { JSObject result = new JSObject(); result.put("granted", true); call.resolve(result); return; }
        requestPermissionForAlias("notifications", call, "notificationPermissionResult");
    }
    @PermissionCallback private void notificationPermissionResult(PluginCall call) {
        JSObject result = new JSObject(); result.put("granted", getPermissionState("notifications") == PermissionState.GRANTED); call.resolve(result);
    }
    @PluginMethod public void checkNotificationPermission(PluginCall call) {
        boolean granted = Build.VERSION.SDK_INT < 33 || getPermissionState("notifications") == PermissionState.GRANTED;
        boolean enabled = getContext().getSharedPreferences("rr_message_candidates_v1", 0).getBoolean("review_notifications_enabled", false);
        JSObject result = new JSObject(); result.put("granted", granted); result.put("enabled", enabled); call.resolve(result);
    }
    @PluginMethod public void setReviewNotificationsEnabled(PluginCall call) {
        boolean enabled = call.getBoolean("enabled", false);
        boolean permissionGranted = Build.VERSION.SDK_INT < 33 || getPermissionState("notifications") == PermissionState.GRANTED;
        if (enabled && !permissionGranted) { call.reject("Android notification permission is not granted."); return; }
        getContext().getSharedPreferences("rr_message_candidates_v1", 0).edit().putBoolean("review_notifications_enabled", enabled).apply();
        NotificationHelper.updateOngoing(getContext(), ParsedCandidateStore.list(getContext()).length());
        call.resolve();
    }
    @PluginMethod public void checkNotificationAccess(PluginCall call) {
        String enabled = Settings.Secure.getString(getContext().getContentResolver(), "enabled_notification_listeners");
        boolean granted = enabled != null && enabled.contains(getContext().getPackageName() + "/" + TransactionNotificationListenerService.class.getName());
        boolean capture = getContext().getSharedPreferences("rr_message_candidates_v1", 0).getBoolean("notification_capture_enabled", false);
        JSObject result = new JSObject(); result.put("granted", granted); result.put("enabled", capture); call.resolve(result);
    }
    @PluginMethod public void setNotificationCaptureEnabled(PluginCall call) {
        boolean enabled = call.getBoolean("enabled", false);
        getContext().getSharedPreferences("rr_message_candidates_v1", 0).edit().putBoolean("notification_capture_enabled", enabled).apply();
        if (enabled) getActivity().startActivity(new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS));
        call.resolve();
    }
    @PluginMethod public void getCandidates(PluginCall call) {
        JSONArray records = ParsedCandidateStore.list(getContext());
        NotificationHelper.updateOngoing(getContext(), records.length());
        JSObject result = new JSObject(); result.put("candidates", records); call.resolve(result);
    }
    @PluginMethod public void dismissCandidate(PluginCall call) {
        String id = call.getString("id", ""); if (!TextUtils.isEmpty(id)) ParsedCandidateStore.dismiss(getContext(), id); call.resolve();
    }
}

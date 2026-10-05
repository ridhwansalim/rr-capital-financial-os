package com.rrcapital.finance;

import com.getcapacitor.BridgeActivity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.WebView;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(MessagingIntakePlugin.class);
        registerPlugin(NativeApkUpdatePlugin.class);
        registerPlugin(BiometricPreferencePlugin.class);
        registerPlugin(LauncherIconPlugin.class);
        registerPlugin(DashboardWidgetPlugin.class);
        super.onCreate(savedInstanceState);
        openPendingIfRequested(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        openPendingIfRequested(intent);
    }

    private void openPendingIfRequested(Intent intent) {
        if (intent == null) return;
        Uri data = intent.getData();
        boolean fromRRActionUrl = data != null
            && "com.rrcapital.financialos".equals(data.getScheme())
            && ("app".equals(data.getHost()) || "action".equals(data.getHost()))
            && data.getPath() != null;
        String path = fromRRActionUrl ? data.getPath() : null;
        String webRoute = intent.getBooleanExtra("openPending", false)
            || ("app".equals(data == null ? null : data.getHost()) && path != null && path.startsWith("/pending-transactions")) ? "/settings?review=pending"
            : "action".equals(data == null ? null : data.getHost()) && "/dashboard".equals(path) ? "/"
            : "action".equals(data == null ? null : data.getHost()) && "/add-transaction".equals(path) ? "/?widgetAction=expense"
            : "action".equals(data == null ? null : data.getHost()) && "/split-bill".equals(path) ? "/?widgetAction=split"
            : path != null && path.startsWith("/quick-expense") ? "/?widgetAction=expense"
            : path != null && path.startsWith("/approvals") ? "/notifications"
            : null;
        if (webRoute == null) return;
        if (bridge == null || bridge.getWebView() == null) return;
        WebView webView = bridge.getWebView();
        // This also handles explicit widget PendingIntents after Android cold-starts the Activity.
        String safeRoute = webRoute.replace("'", "");
        webView.postDelayed(() -> webView.evaluateJavascript("window.location.replace('" + safeRoute + "')", null), 500);
        intent.removeExtra("openPending");
        intent.setData(null);
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        if (bridge != null && bridge.getWebView() != null && bridge.getWebView().canGoBack()) {
            bridge.getWebView().goBack();
            return;
        }
        super.onBackPressed();
    }
}

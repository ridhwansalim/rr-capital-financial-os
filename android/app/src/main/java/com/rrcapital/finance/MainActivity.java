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
        boolean fromUrl = data != null
            && "com.rrcapital.financialos".equals(data.getScheme())
            && "app".equals(data.getHost())
            && data.getPath() != null && data.getPath().startsWith("/pending-transactions");
        if (!intent.getBooleanExtra("openPending", false) && !fromUrl) return;
        if (bridge == null || bridge.getWebView() == null) return;
        WebView webView = bridge.getWebView();
        // The extra is handled natively and this route loads the app's local review screen,
        // including when Android cold-starts the activity from the notification shade.
        webView.postDelayed(() -> webView.evaluateJavascript(
            "window.location.replace('/settings?review=pending')", null), 350);
        intent.removeExtra("openPending");
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

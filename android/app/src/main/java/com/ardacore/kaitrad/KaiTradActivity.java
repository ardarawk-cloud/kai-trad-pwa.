package com.ardacore.kaitrad;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

public class KaiTradActivity extends Activity {
    private static final String HOME_URL = "https://kai-trad-pwa.ardarawk.workers.dev/?native=android";

    private WebView webView;
    private LinearLayout errorPanel;
    private String lastInternalUrl = HOME_URL;
    private boolean loadFailed;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        buildUi();
        configureWebView();
        webView.loadUrl(resolveInitialUrl(getIntent()));
    }

    private String resolveInitialUrl(Intent intent) {
        Uri data = intent == null ? null : intent.getData();
        if (!KaiTradNavigationPolicy.isInternal(data)) return HOME_URL;
        return data.buildUpon().appendQueryParameter("native", "android").build().toString();
    }

    private void buildUi() {
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(5, 5, 5));

        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(5, 5, 5));
        root.addView(webView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));

        errorPanel = new LinearLayout(this);
        errorPanel.setOrientation(LinearLayout.VERTICAL);
        errorPanel.setGravity(Gravity.CENTER);
        errorPanel.setPadding(dp(28), dp(28), dp(28), dp(28));
        errorPanel.setBackgroundColor(Color.rgb(5, 5, 5));
        errorPanel.setVisibility(View.GONE);

        TextView title = new TextView(this);
        title.setText("KAI TRAD tidak dapat terhubung");
        title.setTextColor(Color.WHITE);
        title.setTextSize(20);
        title.setGravity(Gravity.CENTER);
        errorPanel.addView(title, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT));

        TextView detail = new TextView(this);
        detail.setText("Periksa koneksi internet lalu coba lagi. Trading engine dan PAPER state tetap berada di server.");
        detail.setTextColor(Color.rgb(148, 163, 184));
        detail.setTextSize(14);
        detail.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams detailParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT);
        detailParams.topMargin = dp(10);
        errorPanel.addView(detail, detailParams);

        Button retry = new Button(this);
        retry.setText("COBA LAGI");
        retry.setOnClickListener(v -> retryLastPage());
        LinearLayout.LayoutParams retryParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT);
        retryParams.topMargin = dp(20);
        retryParams.gravity = Gravity.CENTER_HORIZONTAL;
        errorPanel.addView(retry, retryParams);

        root.addView(errorPanel, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);
    }

    private void configureWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(false);
        settings.setSafeBrowsingEnabled(true);
        settings.setUserAgentString(settings.getUserAgentString() + " KAITradAndroid/0.1.0");

        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(webView, false);

        boolean debuggable = (getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
        WebView.setWebContentsDebuggingEnabled(debuggable);
        webView.setWebViewClient(new KaiTradWebViewClient());
    }

    private void retryLastPage() {
        hideError();
        webView.loadUrl(lastInternalUrl);
    }

    private void showError() {
        loadFailed = true;
        errorPanel.setVisibility(View.VISIBLE);
    }

    private void hideError() {
        loadFailed = false;
        errorPanel.setVisibility(View.GONE);
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private final class KaiTradWebViewClient extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            if (KaiTradNavigationPolicy.isInternal(uri)) return false;
            return KaiTradNavigationPolicy.openExternal(KaiTradActivity.this, uri);
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, String url) {
            Uri uri = Uri.parse(url);
            if (KaiTradNavigationPolicy.isInternal(uri)) return false;
            return KaiTradNavigationPolicy.openExternal(KaiTradActivity.this, uri);
        }

        @Override
        public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
            Uri uri = Uri.parse(url);
            if (KaiTradNavigationPolicy.isInternal(uri)) lastInternalUrl = url;
            hideError();
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            if (!loadFailed) errorPanel.setVisibility(View.GONE);
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (request.isForMainFrame()) showError();
        }

        @Override
        public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
            if (request.isForMainFrame() && response.getStatusCode() >= 400) showError();
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (webView != null) webView.loadUrl(resolveInitialUrl(intent));
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.stopLoading();
            webView.setWebViewClient(null);
            webView.removeAllViews();
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}

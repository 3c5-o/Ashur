package app.ashur.social;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.annotation.Nullable;
import androidx.webkit.WebViewAssetLoader;

import com.onesignal.Continue;
import com.onesignal.OneSignal;

public class MainActivity extends Activity {
    private static final int FILE_CHOOSER_REQUEST = 4107;
    private static final String LOCAL_APP_URL = "https://appassets.androidplatform.net/assets/www/index.html";
    private WebView webView;
    private ValueCallback<Uri[]> fileCallback;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        webView = new WebView(this);
        setContentView(webView);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setTextZoom(100);
        webView.setBackgroundColor(Color.rgb(5, 7, 6));
        webView.setOverScrollMode(WebView.OVER_SCROLL_NEVER);

        final WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return loader.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String host = uri.getHost() == null ? "" : uri.getHost();
                String scheme = uri.getScheme() == null ? "" : uri.getScheme();

                if ("appassets.androidplatform.net".equals(host)) {
                    return false;
                }

                if ("http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme)) {
                    try {
                        startActivity(new Intent(Intent.ACTION_VIEW, uri));
                        return true;
                    } catch (Exception ignored) {
                        return true;
                    }
                }
                return false;
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(
                    WebView webView,
                    ValueCallback<Uri[]> uploadMsg,
                    FileChooserParams fileChooserParams
            ) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = uploadMsg;
                try {
                    startActivityForResult(fileChooserParams.createIntent(), FILE_CHOOSER_REQUEST);
                    return true;
                } catch (Exception error) {
                    fileCallback = null;
                    return false;
                }
            }
        });

        webView.addJavascriptInterface(new AshurBridge(), "AshurNative");
        webView.loadUrl(LOCAL_APP_URL);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, @Nullable Intent data) {
        if (requestCode == FILE_CHOOSER_REQUEST) {
            if (fileCallback != null) {
                Uri[] result = WebChromeClient.FileChooserParams.parseResult(resultCode, data);
                fileCallback.onReceiveValue(result);
                fileCallback = null;
            }
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    public void onBackPressed() {
        if (webView == null) {
            super.onBackPressed();
            return;
        }

        webView.evaluateJavascript(
                "(function(){try{return window.ASHUR_HANDLE_BACK ? !!window.ASHUR_HANDLE_BACK() : false;}catch(e){return false;}})()",
                handled -> {
                    if (!"true".equals(handled)) {
                        MainActivity.super.onBackPressed();
                    }
                }
        );
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.stopLoading();
            webView.loadUrl("about:blank");
            webView.removeJavascriptInterface("AshurNative");
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    public class AshurBridge {
        @JavascriptInterface
        public String getApiBaseUrl() {
            return BuildConfig.ASHUR_API_URL == null ? "" : BuildConfig.ASHUR_API_URL;
        }
        @JavascriptInterface
        public void openExternal(String url) {
            if (url == null || url.isBlank()) return;
            try {
                Uri uri = Uri.parse(url);
                String scheme = uri.getScheme() == null ? "" : uri.getScheme();
                if (!"http".equalsIgnoreCase(scheme) && !"https".equalsIgnoreCase(scheme)) return;
                startActivity(new Intent(Intent.ACTION_VIEW, uri));
            } catch (Exception ignored) {
            }
        }


        @JavascriptInterface
        public void loginOneSignal(String userId) {
            if (BuildConfig.ONESIGNAL_APP_ID == null || BuildConfig.ONESIGNAL_APP_ID.isBlank()) return;
            if (userId == null || userId.isBlank()) return;
            OneSignal.login(userId);
            OneSignal.getNotifications().requestPermission(true, Continue.none());
        }

        @JavascriptInterface
        public void logoutOneSignal() {
            if (BuildConfig.ONESIGNAL_APP_ID == null || BuildConfig.ONESIGNAL_APP_ID.isBlank()) return;
            OneSignal.logout();
        }
    }
}

package app.ashur.admin;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.widget.Toast;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.annotation.Nullable;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import androidx.webkit.WebViewAssetLoader;

public class MainActivity extends Activity {
    private static final int FILE_CHOOSER_REQUEST = 4207;
    private WebView webView;
    private ValueCallback<Uri[]> fileCallback;
    private long lastBackPressedAt = 0L;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        webView = new WebView(this);
        setContentView(webView);

        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        ViewCompat.setOnApplyWindowInsetsListener(webView, (view, insets) -> {
            Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars());
            view.setPadding(0, bars.top, 0, bars.bottom);
            return insets;
        });
        ViewCompat.requestApplyInsets(webView);
        applySystemTheme(false);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);

        final WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return loader.shouldInterceptRequest(request.getUrl());
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
        webView.loadUrl("https://appassets.androidplatform.net/assets/www/index.html");
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

    private void requestAdminBack() {
        if (webView == null) {
            handleExitBack();
            return;
        }
        webView.evaluateJavascript(
                "(function(){try{return Boolean(window.ASHUR_ADMIN_HANDLE_BACK&&window.ASHUR_ADMIN_HANDLE_BACK())}catch(e){return false}})()",
                value -> {
                    if (!"true".equalsIgnoreCase(String.valueOf(value))) handleExitBack();
                }
        );
    }

    private void handleExitBack() {
        long now = System.currentTimeMillis();
        if (now - lastBackPressedAt < 1800L) {
            finish();
            return;
        }
        lastBackPressedAt = now;
        Toast.makeText(this, "اضغط مرة أخرى للخروج من إدارة آشور", Toast.LENGTH_SHORT).show();
    }

    private void applySystemTheme(boolean light) {
        if (webView == null) return;
        int background = light ? Color.rgb(246, 248, 247) : Color.rgb(5, 7, 6);
        webView.setBackgroundColor(background);
        getWindow().setStatusBarColor(background);
        getWindow().setNavigationBarColor(background);
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(getWindow(), webView);
        if (controller != null) {
            controller.setAppearanceLightStatusBars(light);
            controller.setAppearanceLightNavigationBars(light);
        }
    }

    @Override
    public void onBackPressed() {
        requestAdminBack();
    }

    public class AshurBridge {
        @JavascriptInterface
        public String getApiBaseUrl() {
            return BuildConfig.ASHUR_API_URL == null ? "" : BuildConfig.ASHUR_API_URL;
        }

        @JavascriptInterface
        public void setThemeMode(String mode) {
            runOnUiThread(() -> applySystemTheme("light".equalsIgnoreCase(mode)));
        }
    }
}

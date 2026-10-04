package app.ashur.social;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import org.json.JSONObject;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import androidx.webkit.WebViewAssetLoader;

import com.onesignal.Continue;
import com.onesignal.OneSignal;

public class MainActivity extends Activity {
    private static final int FILE_CHOOSER_REQUEST = 4107;
    private static final int AUDIO_PERMISSION_REQUEST = 4108;
    private static final int MEDIA_PERMISSION_REQUEST = 4109;
    private static final String LOCAL_APP_URL = "https://appassets.androidplatform.net/assets/www/index.html";
    private static final String EXTRA_PUSH_DATA = "ashur_push_data";
    private WebView webView;
    private ValueCallback<Uri[]> fileCallback;
    private PermissionRequest pendingPermissionRequest;
    private String pendingDeepLink;
    private String pendingPushData;
    private long lastBackPressedAt = 0L;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        pendingDeepLink = getIntent() != null ? getIntent().getDataString() : null;
        pendingPushData = getIntent() != null ? getIntent().getStringExtra(EXTRA_PUSH_DATA) : null;

        webView = new WebView(this);
        setContentView(webView);

        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        ViewCompat.setOnApplyWindowInsetsListener(webView, (view, insets) -> {
            Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars());
            view.setPadding(0, bars.top, 0, bars.bottom);
            return WindowInsetsCompat.CONSUMED;
        });
        ViewCompat.requestApplyInsets(webView);
        applySystemTheme(false);

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

                if ("ashur".equalsIgnoreCase(scheme) && "reset-password".equalsIgnoreCase(host)) {
                    handleDeepLink(uri.toString());
                    return true;
                }

                if ("http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme)) {
                    try {
                        startActivity(new Intent(Intent.ACTION_VIEW, uri));
                        return true;
                    } catch (Exception ignored) {
                        return true;
                    }
                }
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                dispatchPendingDeepLink();
                dispatchPendingPushData();
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(PermissionRequest request) {
                runOnUiThread(() -> {
                    boolean wantsAudio = false;
                    boolean wantsVideo = false;
                    for (String resource : request.getResources()) {
                        if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)) wantsAudio = true;
                        if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource)) wantsVideo = true;
                    }

                    if (!wantsAudio && !wantsVideo) {
                        request.deny();
                        return;
                    }

                    boolean audioGranted = !wantsAudio ||
                            ContextCompat.checkSelfPermission(MainActivity.this, Manifest.permission.RECORD_AUDIO)
                                    == PackageManager.PERMISSION_GRANTED;
                    boolean videoGranted = !wantsVideo ||
                            ContextCompat.checkSelfPermission(MainActivity.this, Manifest.permission.CAMERA)
                                    == PackageManager.PERMISSION_GRANTED;

                    if (audioGranted && videoGranted) {
                        java.util.ArrayList<String> resources = new java.util.ArrayList<>();
                        if (wantsAudio) resources.add(PermissionRequest.RESOURCE_AUDIO_CAPTURE);
                        if (wantsVideo) resources.add(PermissionRequest.RESOURCE_VIDEO_CAPTURE);
                        request.grant(resources.toArray(new String[0]));
                        return;
                    }

                    java.util.ArrayList<String> permissions = new java.util.ArrayList<>();
                    if (!audioGranted) permissions.add(Manifest.permission.RECORD_AUDIO);
                    if (!videoGranted) permissions.add(Manifest.permission.CAMERA);
                    pendingPermissionRequest = request;
                    ActivityCompat.requestPermissions(
                            MainActivity.this,
                            permissions.toArray(new String[0]),
                            MEDIA_PERMISSION_REQUEST
                    );
                });
            }

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
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        String deepLink = intent != null ? intent.getDataString() : null;
        if (deepLink != null && !deepLink.isBlank()) {
            handleDeepLink(deepLink);
        }
        handlePushIntent(intent);
    }

    private void handlePushIntent(Intent intent) {
        if (intent == null) return;
        String payload = intent.getStringExtra(EXTRA_PUSH_DATA);
        if (payload == null || payload.isBlank()) return;
        pendingPushData = payload;
        dispatchPendingPushData();
    }

    private void handleDeepLink(String deepLink) {
        if (deepLink == null || deepLink.isBlank()) return;
        pendingDeepLink = deepLink;
        dispatchPendingDeepLink();
    }

    private void dispatchPendingDeepLink() {
        if (webView == null || pendingDeepLink == null || pendingDeepLink.isBlank()) return;
        final String deepLink = pendingDeepLink;
        webView.evaluateJavascript(
                "(function(){try{if(window.ASHUR_HANDLE_AUTH_LINK){window.ASHUR_HANDLE_AUTH_LINK(" +
                        JSONObject.quote(deepLink) +
                        ");return true;}return false;}catch(e){return false;}})()",
                handled -> {
                    if ("true".equals(handled)) {
                        pendingDeepLink = null;
                    }
                }
        );
    }

    private void dispatchPendingPushData() {
        if (webView == null || pendingPushData == null || pendingPushData.isBlank()) return;
        final String payload = pendingPushData;
        webView.evaluateJavascript(
                "(function(){try{if(window.ASHUR_HANDLE_PUSH){return !!window.ASHUR_HANDLE_PUSH(" +
                        JSONObject.quote(payload) +
                        ");}return false;}catch(e){return false;}})()",
                handled -> {
                    if ("true".equals(handled)) {
                        pendingPushData = null;
                    }
                }
        );
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions, @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);

        if (requestCode == AUDIO_PERMISSION_REQUEST) {
            PermissionRequest request = pendingPermissionRequest;
            pendingPermissionRequest = null;
            if (request == null) return;
            if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                request.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
            } else {
                request.deny();
            }
            return;
        }

        if (requestCode != MEDIA_PERMISSION_REQUEST) return;
        PermissionRequest request = pendingPermissionRequest;
        pendingPermissionRequest = null;
        if (request == null) return;

        boolean audioGranted = ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
                == PackageManager.PERMISSION_GRANTED;
        boolean videoGranted = ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA)
                == PackageManager.PERMISSION_GRANTED;

        java.util.ArrayList<String> resources = new java.util.ArrayList<>();
        for (String resource : request.getResources()) {
            if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource) && audioGranted) {
                resources.add(resource);
            }
            if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource) && videoGranted) {
                resources.add(resource);
            }
        }

        if (resources.isEmpty()) request.deny();
        else request.grant(resources.toArray(new String[0]));
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
                        long now = System.currentTimeMillis();
                        if (now - lastBackPressedAt <= 1800L) {
                            MainActivity.super.onBackPressed();
                        } else {
                            lastBackPressedAt = now;
                            Toast.makeText(MainActivity.this, "اضغط رجوع مرة ثانية للخروج", Toast.LENGTH_SHORT).show();
                        }
                    } else {
                        lastBackPressedAt = 0L;
                    }
                }
        );
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
    protected void onDestroy() {
        if (webView != null) {
            webView.stopLoading();
            webView.loadUrl("about:blank");
            webView.removeJavascriptInterface("AshurNative");
            if (pendingPermissionRequest != null) {
                pendingPermissionRequest.deny();
                pendingPermissionRequest = null;
            }
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    public class AshurBridge {
        @JavascriptInterface
        public void authReady() {
            runOnUiThread(() -> {
                dispatchPendingDeepLink();
                dispatchPendingPushData();
            });
        }

        @JavascriptInterface
        public String getApiBaseUrl() {
            return BuildConfig.ASHUR_API_URL == null ? "" : BuildConfig.ASHUR_API_URL;
        }

        @JavascriptInterface
        public void setThemeMode(String mode) {
            runOnUiThread(() -> applySystemTheme("light".equalsIgnoreCase(mode)));
        }

        @JavascriptInterface
        public boolean hasAudioPermission() {
            return ContextCompat.checkSelfPermission(MainActivity.this, Manifest.permission.RECORD_AUDIO)
                    == PackageManager.PERMISSION_GRANTED;
        }

        @JavascriptInterface
        public void requestAudioPermission() {
            runOnUiThread(() -> {
                if (ContextCompat.checkSelfPermission(MainActivity.this, Manifest.permission.RECORD_AUDIO)
                        == PackageManager.PERMISSION_GRANTED) {
                    return;
                }
                ActivityCompat.requestPermissions(
                        MainActivity.this,
                        new String[]{Manifest.permission.RECORD_AUDIO},
                        AUDIO_PERMISSION_REQUEST
                );
            });
        }

        @JavascriptInterface
        public boolean hasCameraPermission() {
            return ContextCompat.checkSelfPermission(MainActivity.this, Manifest.permission.CAMERA)
                    == PackageManager.PERMISSION_GRANTED;
        }

        @JavascriptInterface
        public void requestCameraPermission() {
            runOnUiThread(() -> {
                if (ContextCompat.checkSelfPermission(MainActivity.this, Manifest.permission.CAMERA)
                        == PackageManager.PERMISSION_GRANTED) {
                    return;
                }
                ActivityCompat.requestPermissions(
                        MainActivity.this,
                        new String[]{Manifest.permission.CAMERA},
                        MEDIA_PERMISSION_REQUEST
                );
            });
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

(()=>{
  const nativeHost = window.location.hostname === "appassets.androidplatform.net";
  const nativeApi = window.AshurNative?.getApiBaseUrl?.() || "";
  const origin = window.location.origin;
  window.ASHUR_CONFIG = {
    supabaseUrl: "https://pwpjrwcynnicexrmunkd.supabase.co",
    supabaseKey: "sb_publishable_sj7LvpsRztNtSaK9jvzQsg_ypXNxXQT",
    apiBaseUrl: nativeApi || (nativeHost ? "https://exciting-miracle-production-b2cf.up.railway.app" : origin),
    shareBaseUrl: "https://3c5-o.github.io/Ashur",
    webBaseUrl: nativeHost ? "https://3c5-o.github.io/Ashur/app/" : origin + "/apps/user-web/",
    authRedirectUrl: nativeHost ? "ashur://reset-password" : origin + "/apps/user-web/",
    webVendorFallbackUrl: "./vendor/supabase.min.js",
    maxUploadMb: 60,
    appVersion: "2.0.0"
  };
})();

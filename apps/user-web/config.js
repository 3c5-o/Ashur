(()=>{
  const nativeHost=window.location.hostname==="appassets.androidplatform.net";
  const origin = window.location.origin;
  window.ASHUR_CONFIG = {
    supabaseUrl: "https://pwpjrwcynnicexrmunkd.supabase.co",
    supabaseKey: "sb_publishable_sj7LvpsRztNtSaK9jvzQsg_ypXNxXQT",
    apiBaseUrl: origin,
    shareBaseUrl: origin,
    webBaseUrl: origin + "/apps/user-web/",
    authRedirectUrl: nativeHost ? "ashur://reset-password" : origin + "/apps/user-web/",
    webVendorFallbackUrl: "./vendor/supabase.min.js",
    maxUploadMb: 60,
    appVersion: "2.0.0"
  };
})();

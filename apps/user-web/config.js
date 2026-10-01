(()=>{
  const nativeHost=window.location.hostname==="appassets.androidplatform.net";
  window.ASHUR_CONFIG = {
    supabaseUrl: "https://pwpjrwcynnicexrmunkd.supabase.co",
    supabaseKey: "sb_publishable_sj7LvpsRztNtSaK9jvzQsg_ypXNxXQT",
    apiBaseUrl: "https://exciting-miracle-production-b2cf.up.railway.app",
    shareBaseUrl: "https://3c5-o.github.io/Ashur",
    webBaseUrl: "https://3c5-o.github.io/Ashur/app/",
    authRedirectUrl: nativeHost ? "ashur://reset-password" : "https://3c5-o.github.io/Ashur/app/",
    maxUploadMb: 60,
    appVersion: "1.9.0"
  };
})();

export const config = {
  port: Number(process.env.PORT || 8080),
  supabaseUrl: (process.env.SUPABASE_URL || "").replace(/\/$/, ""),
  publishableKey: process.env.SUPABASE_PUBLISHABLE_KEY || "",
  serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || "",
  telegramApiId: Number(process.env.TELEGRAM_API_ID || 0),
  telegramApiHash: process.env.TELEGRAM_API_HASH || "",
  telegramSession: process.env.TELEGRAM_SESSION || "",
  telegramAdminId: process.env.TELEGRAM_ADMIN_ID || "",
  oneSignalAppId: process.env.ONESIGNAL_APP_ID || "",
  oneSignalKey: process.env.ONESIGNAL_REST_API_KEY || "",
  ownerUserId: process.env.OWNER_USER_ID || "",
  maxUploadBytes: Number(process.env.MAX_UPLOAD_MB || 60) * 1024 * 1024,
  cacheMinutes: Number(process.env.MEDIA_CACHE_MINUTES || 20),
  mediaTicketMinutes: Number(process.env.MEDIA_TICKET_MINUTES || 10),
};

export function readiness() {
  return {
    database: Boolean(config.supabaseUrl && config.publishableKey && config.serviceRoleKey),
    telegram: Boolean(config.telegramBotToken && config.telegramApiId && config.telegramApiHash),
    notifications: Boolean(config.oneSignalAppId && config.oneSignalKey),
    owner: Boolean(config.ownerUserId),
  };
}

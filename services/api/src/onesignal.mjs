import { config } from "./config.mjs";

const endpoint = "https://api.onesignal.com/notifications";

export function notificationsConfigured() {
  return Boolean(config.oneSignalAppId && config.oneSignalKey);
}

export async function sendPush({
  userIds,
  title,
  body,
  data = {},
  all = false,
  idempotencyKey,
}) {
  if (!notificationsConfigured()) {
    return { ok: false, skipped: true, reason: "لم تتم إضافة بيانات الإشعارات بعد" };
  }

  const payload = {
    app_id: config.oneSignalAppId,
    target_channel: "push",
    headings: { ar: title, en: title },
    contents: { ar: body, en: body },
    data,
    ...(idempotencyKey ? { idempotency_key: idempotencyKey } : {}),
  };

  if (all) {
    payload.included_segments = ["Subscribed Users"];
  } else {
    const ids = [...new Set((userIds || []).filter(Boolean))];
    if (!ids.length) return { ok: false, skipped: true, reason: "لا يوجد مستلمون" };
    payload.include_aliases = { external_id: ids };
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Key ${config.oneSignalKey}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(payload),
  });

  const text = await response.text();
  let result;
  try { result = text ? JSON.parse(text) : {}; } catch { result = { raw: text }; }

  if (!response.ok) {
    throw new Error(result?.errors?.join?.("، ") || result?.errors || result?.message || "فشل إرسال الإشعار");
  }

  return {
    ok: Boolean(result?.id),
    id: result?.id || null,
    errors: result?.errors || null,
  };
}

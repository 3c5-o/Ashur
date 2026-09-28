import http from "node:http";

const PORT = Number(process.env.PORT || 8080);
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const ADMIN_ID = String(process.env.TELEGRAM_ADMIN_ID || "");
const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

const channels = [
  ["profile_images", "آشور - صور الحسابات"],
  ["posts_media", "آشور - وسائط المنشورات"],
  ["reels", "آشور - مقاطع الريلز"],
  ["stories", "آشور - القصص"],
  ["chat_media", "آشور - وسائط المحادثات"],
  ["group_media", "آشور - وسائط المجموعات"],
  ["general_files", "آشور - الملفات العامة"],
  ["storage_logs", "آشور - سجل التخزين"],
  ["storage_errors", "آشور - أخطاء التخزين"],
  ["backups", "آشور - النسخ الاحتياطي"],
];

const allowedBotRoles = new Set([
  "secondary_admin",
  "moderator",
  "content_moderator",
  "support",
  "analyst",
]);

const rolePermissions = {
  secondary_admin: new Set(["status", "channels", "uploads", "errors", "logs", "admins"]),
  moderator: new Set(["status", "channels", "uploads", "errors", "logs"]),
  content_moderator: new Set(["status", "logs"]),
  support: new Set(["status", "errors", "logs"]),
  analyst: new Set(["status", "logs"]),
};

let offset = 0;
let me = null;
let polling = false;
let alertTimer = null;

function configured() {
  return Boolean(BOT_TOKEN && ADMIN_ID && SUPABASE_URL && SERVICE_KEY);
}

function formatBytes(value) {
  const n = Number(value || 0);
  if (n < 1024) return n + " B";
  if (n < 1024 ** 2) return (n / 1024).toFixed(1) + " KB";
  if (n < 1024 ** 3) return (n / 1024 ** 2).toFixed(1) + " MB";
  return (n / 1024 ** 3).toFixed(2) + " GB";
}

function shortText(value, max = 120) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}

function roleLabel(role) {
  return ({
    owner: "المالك",
    secondary_admin: "مدير ثانوي",
    moderator: "مشرف",
    content_moderator: "مشرف محتوى",
    support: "دعم",
    analyst: "محلل",
  })[role] || role;
}

async function tg(method, body = {}) {
  if (!BOT_TOKEN) throw new Error("توكن البوت غير مضاف");
  const response = await fetch("https://api.telegram.org/bot" + BOT_TOKEN + "/" + method, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!result.ok) throw new Error(result.description || "فشل طلب تيليجرام");
  return result.result;
}

async function db(path, { method = "GET", body, prefer } = {}) {
  if (!SUPABASE_URL || !SERVICE_KEY) throw new Error("بيانات قاعدة البيانات غير مكتملة");
  const headers = {
    apikey: SERVICE_KEY,
    Authorization: "Bearer " + SERVICE_KEY,
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (prefer) headers.Prefer = prefer;
  const response = await fetch(SUPABASE_URL + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!response.ok) throw new Error(data?.message || data?.error || text || "فشل طلب قاعدة البيانات");
  return data;
}

async function upsert(table, body, onConflict) {
  return db("/rest/v1/" + table + "?on_conflict=" + encodeURIComponent(onConflict), {
    method: "POST",
    body,
    prefer: "resolution=merge-duplicates,return=representation",
  });
}

async function channelRows() {
  return db("/rest/v1/storage_channels?select=channel_key,channel_id,title,status,last_test_at,last_upload_at,enabled&order=channel_key.asc");
}

async function uploadRows(status = "", limit = 20) {
  let path = "/rest/v1/upload_jobs?select=id,client_upload_id,user_id,kind,original_name,size_bytes,received_bytes,status,error,media_id,cancel_requested,created_at,updated_at,completed_at&order=created_at.desc&limit=" + Number(limit || 20);
  if (status) path += "&status=eq." + encodeURIComponent(status);
  return db(path);
}

async function errorRows(status = "new", limit = 20, unalerted = false) {
  let path = "/rest/v1/system_errors?select=id,service,code,message,status,created_at,resolved_at,bot_alerted_at&order=created_at.desc&limit=" + Number(limit || 20);
  if (status) path += "&status=eq." + encodeURIComponent(status);
  if (unalerted) path += "&bot_alerted_at=is.null";
  return db(path);
}

async function auditRows(limit = 20) {
  return db("/rest/v1/audit_logs?select=id,actor_user_id,actor_telegram_id,action,target_type,target_id,created_at&order=created_at.desc&limit=" + Number(limit || 20));
}

async function botAdminRows() {
  return db("/rest/v1/bot_admins?select=telegram_user_id,role,permissions,active,added_by_telegram_id,created_at,updated_at&order=created_at.asc");
}

async function writeBotAudit(action, targetType = null, targetId = null, details = {}) {
  return db("/rest/v1/audit_logs", {
    method: "POST",
    body: {
      actor_telegram_id: ADMIN_ID,
      action,
      target_type: targetType,
      target_id: targetId == null ? null : String(targetId),
      details,
    },
    prefer: "return=minimal",
  }).catch(() => {});
}

async function pending(userId) {
  const rows = await db(
    "/rest/v1/bot_pending?select=*&telegram_user_id=eq." + encodeURIComponent(userId) + "&limit=1",
  );
  return rows?.[0] || null;
}

async function clearPending(userId) {
  await db("/rest/v1/bot_pending?telegram_user_id=eq." + encodeURIComponent(userId), {
    method: "DELETE",
    prefer: "return=minimal",
  });
}

async function setPending(userId, action, payload) {
  await upsert("bot_pending", {
    telegram_user_id: String(userId),
    action,
    payload,
    expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
  }, "telegram_user_id");
}

async function botActor(from) {
  if (!from) return null;
  const id = String(from.id);
  if (id === ADMIN_ID) {
    return { telegram_user_id: id, role: "owner", permissions: {}, active: true };
  }
  const rows = await db(
    "/rest/v1/bot_admins?select=telegram_user_id,role,permissions,active&telegram_user_id=eq." +
      encodeURIComponent(id) + "&active=eq.true&limit=1",
  ).catch(() => []);
  return rows?.[0] || null;
}

function hasPermission(actor, permission) {
  if (!actor?.active) return false;
  if (actor.role === "owner") return true;
  if (actor.permissions?.[permission] === true) return true;
  if (actor.permissions?.[permission] === false) return false;
  return rolePermissions[actor.role]?.has(permission) || false;
}

async function requireActor(from, permission = "status") {
  const actor = await botActor(from);
  if (!actor || !hasPermission(actor, permission)) {
    const error = new Error("غير مصرح بهذه العملية");
    error.statusCode = 403;
    throw error;
  }
  return actor;
}

function mainKeyboard(actor) {
  const rows = [];
  if (hasPermission(actor, "status") || hasPermission(actor, "channels")) {
    rows.push([
      ...(hasPermission(actor, "status") ? [{ text: "حالة النظام", callback_data: "status" }] : []),
      ...(hasPermission(actor, "channels") ? [{ text: "قنوات التخزين", callback_data: "channels" }] : []),
    ]);
  }
  if (hasPermission(actor, "uploads")) {
    rows.push([
      { text: "عمليات الرفع", callback_data: "queue" },
      { text: "الرفع الفاشل", callback_data: "failed" },
    ]);
  }
  if (hasPermission(actor, "errors") || hasPermission(actor, "logs")) {
    rows.push([
      ...(hasPermission(actor, "errors") ? [{ text: "أخطاء النظام", callback_data: "errors" }] : []),
      ...(hasPermission(actor, "logs") ? [{ text: "سجل العمليات", callback_data: "logs" }] : []),
    ]);
  }
  if (hasPermission(actor, "channels") || hasPermission(actor, "admins")) {
    rows.push([
      ...(hasPermission(actor, "channels") ? [{ text: "اختبار القنوات", callback_data: "test_all" }] : []),
      ...(hasPermission(actor, "admins") ? [{ text: "مشرفو البوت", callback_data: "admins" }] : []),
    ]);
  }
  return { inline_keyboard: rows.filter((row) => row.length) };
}

async function sendMain(chatId, actor, text = "لوحة تشغيل آشور\n\nاختر العملية المطلوبة:") {
  return tg("sendMessage", {
    chat_id: chatId,
    text,
    reply_markup: mainKeyboard(actor),
  });
}

async function editMain(chatId, messageId, actor, text = "لوحة تشغيل آشور\n\nاختر العملية المطلوبة:") {
  return tg("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text,
    reply_markup: mainKeyboard(actor),
  });
}

async function sendChannels(chatId, actor, messageId = null) {
  await requireActor({ id: actor.telegram_user_id }, "channels");
  const rows = await channelRows();
  const map = new Map((rows || []).map((x) => [x.channel_key, x]));
  const keyboard = channels.map(([key, title]) => {
    const linked = map.get(key)?.status === "connected" && map.get(key)?.enabled !== false;
    return [{
      text: (linked ? "✓ " : "• ") + title,
      callback_data: "link:" + key,
    }];
  });
  keyboard.push([{ text: "رجوع", callback_data: "home" }]);
  const body = {
    chat_id: chatId,
    text: "قنوات التخزين\n\nاختر القناة التي تريد ربطها أو تغييرها:",
    reply_markup: { inline_keyboard: keyboard },
  };
  if (messageId) return tg("editMessageText", { ...body, message_id: messageId });
  return tg("sendMessage", body);
}

async function validateChannel(channelId) {
  if (!me) me = await tg("getMe");
  const chat = await tg("getChat", { chat_id: channelId });
  const membership = await tg("getChatMember", {
    chat_id: channelId,
    user_id: me.id,
  });
  if (!["administrator", "creator"].includes(membership.status)) {
    throw new Error("البوت ليس مشرفًا في هذه القناة");
  }
  const test = await tg("sendMessage", {
    chat_id: channelId,
    text: "اختبار ربط تخزين آشور",
    disable_notification: true,
  });
  await tg("deleteMessage", {
    chat_id: channelId,
    message_id: test.message_id,
  }).catch(() => {});
  return chat;
}

async function saveChannel(adminId, key, channelId, chat) {
  const expected = channels.find(([k]) => k === key)?.[1] || chat?.title || key;
  await upsert("storage_channels", {
    channel_key: key,
    channel_id: String(channelId),
    title: expected,
    enabled: true,
    status: "connected",
    linked_by_telegram_id: String(adminId),
    last_test_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }, "channel_key");

  await db("/rest/v1/audit_logs", {
    method: "POST",
    body: {
      actor_telegram_id: String(adminId),
      action: "link_storage_channel",
      target_type: "storage_channel",
      target_id: key,
      details: {
        channel_id: String(channelId),
        telegram_title: chat?.title || "",
      },
    },
    prefer: "return=minimal",
  }).catch(() => {});
}

async function sendStatus(chatId, actor) {
  await requireActor({ id: actor.telegram_user_id }, "status");
  const [rows, activeUploads, failedUploads, errors, admins] = await Promise.all([
    channelRows().catch(() => []),
    db("/rest/v1/upload_jobs?select=id&status=in.(queued,receiving,storing)&limit=1000").catch(() => []),
    db("/rest/v1/upload_jobs?select=id&status=eq.failed&limit=1000").catch(() => []),
    errorRows("new", 100).catch(() => []),
    botAdminRows().catch(() => []),
  ]);
  const connected = (rows || []).filter((x) => x.status === "connected" && x.enabled !== false).length;
  const text = [
    "حالة نظام آشور",
    "",
    "القنوات: " + connected + " من " + channels.length,
    "رفع جارٍ: " + (activeUploads?.length || 0),
    "رفع فاشل: " + (failedUploads?.length || 0),
    "أخطاء جديدة: " + (errors?.length || 0),
    "مشرفو البوت النشطون: " + (admins || []).filter((x) => x.active).length,
    "البوت: " + (polling ? "يعمل" : "متوقف"),
  ].join("\n");
  return tg("sendMessage", {
    chat_id: chatId,
    text,
    reply_markup: { inline_keyboard: [[{ text: "تحديث الحالة", callback_data: "status" }, { text: "رجوع", callback_data: "home" }]] },
  });
}

async function sendUploads(chatId, actor, mode = "active") {
  await requireActor({ id: actor.telegram_user_id }, "uploads");
  let rows = [];
  if (mode === "failed") {
    rows = await uploadRows("failed", 20);
  } else {
    const all = await uploadRows("", 40);
    rows = (all || []).filter((r) => ["queued", "receiving", "storing"].includes(r.status)).slice(0, 20);
  }

  if (!rows?.length) {
    return tg("sendMessage", {
      chat_id: chatId,
      text: mode === "failed" ? "لا توجد عمليات رفع فاشلة." : "لا توجد عمليات رفع جارية.",
      reply_markup: { inline_keyboard: [[{ text: "رجوع", callback_data: "home" }]] },
    });
  }

  const lines = rows.map((r, index) => {
    const total = Number(r.size_bytes || 0);
    const got = Number(r.received_bytes || 0);
    const pct = total ? Math.min(100, Math.round(got / total * 100)) : 0;
    const detail = r.status === "failed" ? shortText(r.error || "فشل غير محدد", 80) : pct + "%";
    return (index + 1) + ". " + shortText(r.original_name || "ملف", 45) + "\n" +
      "   " + r.kind + " · " + formatBytes(total) + " · " + r.status + " · " + detail;
  });

  const keyboard = [];
  if (mode !== "failed") {
    for (const row of rows.slice(0, 8)) {
      keyboard.push([{ text: "إلغاء: " + shortText(row.original_name || row.id, 28), callback_data: "cancel_upload:" + row.id }]);
    }
  }
  keyboard.push([{ text: mode === "failed" ? "تحديث" : "تحديث العمليات", callback_data: mode === "failed" ? "failed" : "queue" }, { text: "رجوع", callback_data: "home" }]);
  return tg("sendMessage", {
    chat_id: chatId,
    text: (mode === "failed" ? "آخر عمليات الرفع الفاشلة" : "عمليات الرفع الجارية") + "\n\n" + lines.join("\n\n"),
    reply_markup: { inline_keyboard: keyboard },
  });
}

async function sendErrors(chatId, actor) {
  await requireActor({ id: actor.telegram_user_id }, "errors");
  const rows = await errorRows("new", 15);
  if (!rows?.length) {
    return tg("sendMessage", {
      chat_id: chatId,
      text: "لا توجد أخطاء جديدة.",
      reply_markup: { inline_keyboard: [[{ text: "تحديث", callback_data: "errors" }, { text: "رجوع", callback_data: "home" }]] },
    });
  }
  const lines = rows.map((r, index) =>
    (index + 1) + ". " + r.service + (r.code ? " · " + r.code : "") + "\n   " + shortText(r.message, 120),
  );
  const keyboard = rows.slice(0, 8).map((r) => [
    { text: "تمت معالجة #" + r.id, callback_data: "resolve_error:" + r.id },
  ]);
  keyboard.push([{ text: "تحديث", callback_data: "errors" }, { text: "رجوع", callback_data: "home" }]);
  return tg("sendMessage", {
    chat_id: chatId,
    text: "أخطاء النظام الجديدة\n\n" + lines.join("\n\n"),
    reply_markup: { inline_keyboard: keyboard },
  });
}

async function sendLogs(chatId, actor) {
  await requireActor({ id: actor.telegram_user_id }, "logs");
  const rows = await auditRows(20);
  const lines = (rows || []).map((r, index) => {
    const actorText = r.actor_telegram_id ? "Telegram " + r.actor_telegram_id : (r.actor_user_id ? "User " + r.actor_user_id.slice(0, 8) : "System");
    return (index + 1) + ". " + shortText(r.action, 45) + "\n   " + actorText +
      (r.target_type ? " · " + r.target_type : "") +
      (r.target_id ? " · " + shortText(r.target_id, 28) : "");
  });
  return tg("sendMessage", {
    chat_id: chatId,
    text: "سجل العمليات\n\n" + (lines.join("\n\n") || "السجل فارغ."),
    reply_markup: { inline_keyboard: [[{ text: "تحديث", callback_data: "logs" }, { text: "رجوع", callback_data: "home" }]] },
  });
}

async function sendAdmins(chatId, actor) {
  await requireActor({ id: actor.telegram_user_id }, "admins");
  const rows = await botAdminRows();
  const lines = [
    "المالك: " + ADMIN_ID,
    ...(rows || []).map((r, index) =>
      (index + 1) + ". " + r.telegram_user_id + " · " + roleLabel(r.role) + " · " + (r.active ? "نشط" : "متوقف"),
    ),
  ];
  const keyboard = [
    [
      { text: "إضافة مشرف", callback_data: "add_bot_admin" },
      ...(actor.role === "owner" ? [{ text: "مالك إدارة التطبيق", callback_data: "set_app_owner" }] : []),
    ],
    ...(rows || []).slice(0, 8).map((r) => [
      { text: (r.active ? "تعطيل " : "تفعيل ") + r.telegram_user_id, callback_data: "toggle_bot_admin:" + r.telegram_user_id },
      { text: "حذف", callback_data: "delete_bot_admin:" + r.telegram_user_id },
    ]),
    [{ text: "رجوع", callback_data: "home" }],
  ];
  return tg("sendMessage", {
    chat_id: chatId,
    text: "مشرفو بوت آشور\n\n" + lines.join("\n"),
    reply_markup: { inline_keyboard: keyboard },
  });
}

async function handleText(message) {
  const from = message.from;
  const text = String(message.text || "").trim();

  if (text === "/id") {
    return tg("sendMessage", {
      chat_id: message.chat.id,
      text: "معرف حسابك في تيليجرام: " + String(from?.id || ""),
    }).catch(() => {});
  }

  const actor = await botActor(from);
  if (!actor) {
    return tg("sendMessage", {
      chat_id: message.chat.id,
      text: "هذا البوت مخصص لإدارة نظام آشور.",
    }).catch(() => {});
  }

  if (text === "/start" || text === "/menu") {
    await clearPending(from.id).catch(() => {});
    return sendMain(message.chat.id, actor);
  }
  if (text === "/status") return sendStatus(message.chat.id, actor);
  if (text === "/queue") return sendUploads(message.chat.id, actor, "active");
  if (text === "/errors") return sendErrors(message.chat.id, actor);
  if (text === "/logs") return sendLogs(message.chat.id, actor);
  if (text === "/admins") return sendAdmins(message.chat.id, actor);

  if (text === "/cancel" || text === "إلغاء") {
    await clearPending(from.id).catch(() => {});
    return sendMain(message.chat.id, actor, "تم إلغاء العملية.");
  }

  const p = await pending(from.id);
  if (!p || new Date(p.expires_at) <= new Date()) {
    if (p) await clearPending(from.id).catch(() => {});
    return sendMain(message.chat.id, actor, "اختر العملية من القائمة.");
  }

  if (p.action === "link_channel") {
    if (!hasPermission(actor, "channels")) {
      await clearPending(from.id).catch(() => {});
      return tg("sendMessage", { chat_id: message.chat.id, text: "لا تملك صلاحية ربط القنوات." });
    }
    if (!/^-100\d{5,}$/.test(text)) {
      return tg("sendMessage", {
        chat_id: message.chat.id,
        text: "المعرف غير صالح. أرسل معرف القناة الذي يبدأ بـ -100 أو أرسل /cancel للإلغاء.",
      });
    }

    const key = p.payload?.channel_key;
    const title = channels.find(([k]) => k === key)?.[1] || "القناة";
    await tg("sendMessage", { chat_id: message.chat.id, text: "جارٍ فحص " + title + "..." });

    try {
      const chat = await validateChannel(text);
      await saveChannel(from.id, key, text, chat);
      await clearPending(from.id);
      await tg("sendMessage", {
        chat_id: message.chat.id,
        text: "تم ربط " + title + " بنجاح.\n\nمعرف القناة: " + text,
      });
      return sendMain(message.chat.id, actor);
    } catch (error) {
      return tg("sendMessage", {
        chat_id: message.chat.id,
        text: "تعذر ربط القناة:\n" + error.message + "\n\nتأكد أن البوت مشرف وله صلاحية النشر والحذف.",
      });
    }
  }

  if (p.action === "set_app_owner") {
    if (actor.role !== "owner") {
      await clearPending(from.id).catch(() => {});
      return tg("sendMessage", { chat_id: message.chat.id, text: "هذه العملية للمالك الرئيسي فقط." });
    }
    const identifier = text.replace(/^@/, "").trim();
    let profiles = [];
    if (/^[0-9a-f-]{36}$/i.test(identifier)) {
      profiles = await db("/rest/v1/profiles?select=id,name,username&id=eq." + encodeURIComponent(identifier) + "&limit=1");
    } else {
      profiles = await db("/rest/v1/profiles?select=id,name,username&username=eq." + encodeURIComponent(identifier) + "&limit=1");
    }
    const profile = profiles?.[0];
    if (!profile) {
      return tg("sendMessage", {
        chat_id: message.chat.id,
        text: "الحساب غير موجود. أرسل اسم المستخدم داخل آشور أو UUID الحساب.",
      });
    }
    const owners = await db("/rest/v1/admins?select=user_id&role=eq.owner&active=eq.true").catch(() => []);
    for (const row of owners || []) {
      if (row.user_id === profile.id) continue;
      await db("/rest/v1/admins?user_id=eq." + encodeURIComponent(row.user_id), {
        method: "PATCH",
        body: { role: "secondary_admin", updated_at: new Date().toISOString() },
        prefer: "return=minimal",
      }).catch(() => {});
    }
    await upsert("admins", {
      user_id: profile.id,
      role: "owner",
      permissions: { all: true },
      active: true,
      updated_at: new Date().toISOString(),
    }, "user_id");
    await writeBotAudit("set_app_owner", "admin", profile.id, {
      username: profile.username || "",
      by: String(from.id),
    });
    await clearPending(from.id);
    return tg("sendMessage", {
      chat_id: message.chat.id,
      text: "تم تعيين @" + (profile.username || profile.name || profile.id) + " كمالك رئيسي لتطبيق الإدارة.",
    });
  }

  if (p.action === "add_bot_admin") {
    if (!hasPermission(actor, "admins")) {
      await clearPending(from.id).catch(() => {});
      return tg("sendMessage", { chat_id: message.chat.id, text: "لا تملك صلاحية إدارة المشرفين." });
    }
    const parts = text.split(/\s+/).filter(Boolean);
    const telegramUserId = parts[0] || "";
    const role = parts[1] || "moderator";
    if (!/^\d{5,20}$/.test(telegramUserId) || !allowedBotRoles.has(role)) {
      return tg("sendMessage", {
        chat_id: message.chat.id,
        text: "الصيغة غير صحيحة.\n\nأرسل: TelegramID role\nمثال: 123456789 moderator\n\nالأدوار: secondary_admin, moderator, content_moderator, support, analyst",
      });
    }
    if (telegramUserId === ADMIN_ID) {
      await clearPending(from.id).catch(() => {});
      return tg("sendMessage", { chat_id: message.chat.id, text: "هذا الحساب هو المالك بالفعل." });
    }
    await upsert("bot_admins", {
      telegram_user_id: telegramUserId,
      role,
      permissions: {},
      active: true,
      added_by_telegram_id: String(from.id),
      updated_at: new Date().toISOString(),
    }, "telegram_user_id");
    await writeBotAudit("add_bot_admin", "telegram_user", telegramUserId, { role, by: String(from.id) });
    await clearPending(from.id);
    await tg("sendMessage", {
      chat_id: message.chat.id,
      text: "تمت إضافة " + telegramUserId + " بدور " + roleLabel(role) + ".",
    });
    return sendAdmins(message.chat.id, actor);
  }
}

async function handleCallback(query) {
  const actor = await botActor(query.from);
  if (!actor) {
    return tg("answerCallbackQuery", {
      callback_query_id: query.id,
      text: "غير مصرح",
      show_alert: true,
    });
  }

  const data = String(query.data || "");
  const chatId = query.message?.chat?.id;
  const messageId = query.message?.message_id;
  await tg("answerCallbackQuery", { callback_query_id: query.id }).catch(() => {});

  try {
    if (data === "home") {
      await clearPending(query.from.id).catch(() => {});
      return editMain(chatId, messageId, actor);
    }

    if (data === "status") return sendStatus(chatId, actor);
    if (data === "channels") return sendChannels(chatId, actor, messageId);
    if (data === "queue") return sendUploads(chatId, actor, "active");
    if (data === "failed") return sendUploads(chatId, actor, "failed");
    if (data === "errors") return sendErrors(chatId, actor);
    if (data === "logs") return sendLogs(chatId, actor);
    if (data === "admins") return sendAdmins(chatId, actor);

    if (data === "set_app_owner") {
      if (actor.role !== "owner") throw new Error("هذه العملية للمالك الرئيسي فقط");
      await setPending(query.from.id, "set_app_owner", {});
      return tg("sendMessage", {
        chat_id: chatId,
        text: "تعيين مالك تطبيق الإدارة\n\nأرسل اسم المستخدم داخل آشور مثل: hamad\nأو UUID الحساب.\n\nللإلغاء أرسل /cancel",
      });
    }

    if (data === "test_all") {
      await requireActor(query.from, "channels");
      const rows = await channelRows();
      if (!rows?.length) return tg("sendMessage", { chat_id: chatId, text: "لا توجد قنوات مربوطة بعد." });
      let ok = 0;
      let failed = 0;
      for (const row of rows) {
        try {
          await validateChannel(row.channel_id);
          await db("/rest/v1/storage_channels?channel_key=eq." + encodeURIComponent(row.channel_key), {
            method: "PATCH",
            body: {
              status: "connected",
              last_test_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
            prefer: "return=minimal",
          });
          ok++;
        } catch {
          failed++;
          await db("/rest/v1/storage_channels?channel_key=eq." + encodeURIComponent(row.channel_key), {
            method: "PATCH",
            body: {
              status: "error",
              last_test_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
            prefer: "return=minimal",
          }).catch(() => {});
        }
      }
      await writeBotAudit("test_storage_channels", "storage", null, { ok, failed, by: String(query.from.id) });
      return tg("sendMessage", {
        chat_id: chatId,
        text: "اكتمل فحص القنوات.\n\nتعمل: " + ok + "\nتحتاج مراجعة: " + failed,
      });
    }

    if (data.startsWith("link:")) {
      await requireActor(query.from, "channels");
      const key = data.slice(5);
      const channel = channels.find(([k]) => k === key);
      if (!channel) return;
      await setPending(query.from.id, "link_channel", { channel_key: key });
      return tg("sendMessage", {
        chat_id: chatId,
        text: "ربط " + channel[1] + "\n\nأرسل الآن معرف القناة الذي يبدأ بـ -100.\n\nللإلغاء أرسل /cancel",
      });
    }

    if (data.startsWith("cancel_upload:")) {
      await requireActor(query.from, "uploads");
      const id = data.slice("cancel_upload:".length);
      if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("معرف الرفع غير صالح");
      await db("/rest/v1/upload_jobs?id=eq." + encodeURIComponent(id), {
        method: "PATCH",
        body: { cancel_requested: true, updated_at: new Date().toISOString() },
        prefer: "return=minimal",
      });
      await writeBotAudit("cancel_upload_from_bot", "upload_job", id, { by: String(query.from.id) });
      return tg("sendMessage", { chat_id: chatId, text: "تم إرسال طلب إلغاء الرفع." });
    }

    if (data.startsWith("resolve_error:")) {
      await requireActor(query.from, "errors");
      const id = data.slice("resolve_error:".length);
      if (!/^\d+$/.test(id)) throw new Error("معرف الخطأ غير صالح");
      await db("/rest/v1/system_errors?id=eq." + encodeURIComponent(id), {
        method: "PATCH",
        body: { status: "resolved", resolved_at: new Date().toISOString() },
        prefer: "return=minimal",
      });
      await writeBotAudit("resolve_system_error_from_bot", "system_error", id, { by: String(query.from.id) });
      return sendErrors(chatId, actor);
    }

    if (data === "add_bot_admin") {
      await requireActor(query.from, "admins");
      await setPending(query.from.id, "add_bot_admin", {});
      return tg("sendMessage", {
        chat_id: chatId,
        text: "أرسل معرف تيليجرام ثم الدور بهذا الشكل:\n\n123456789 moderator\n\nالأدوار: secondary_admin, moderator, content_moderator, support, analyst\n\nيمكن للمستخدم معرفة معرفه بإرسال /id.",
      });
    }

    if (data.startsWith("toggle_bot_admin:")) {
      await requireActor(query.from, "admins");
      const target = data.slice("toggle_bot_admin:".length);
      const rows = await db("/rest/v1/bot_admins?select=telegram_user_id,active&telegram_user_id=eq." + encodeURIComponent(target) + "&limit=1");
      const row = rows?.[0];
      if (!row) throw new Error("المشرف غير موجود");
      await db("/rest/v1/bot_admins?telegram_user_id=eq." + encodeURIComponent(target), {
        method: "PATCH",
        body: { active: !row.active, updated_at: new Date().toISOString() },
        prefer: "return=minimal",
      });
      await writeBotAudit("toggle_bot_admin", "telegram_user", target, { active: !row.active, by: String(query.from.id) });
      return sendAdmins(chatId, actor);
    }

    if (data.startsWith("delete_bot_admin:")) {
      await requireActor(query.from, "admins");
      const target = data.slice("delete_bot_admin:".length);
      await db("/rest/v1/bot_admins?telegram_user_id=eq." + encodeURIComponent(target), {
        method: "DELETE",
        prefer: "return=minimal",
      });
      await writeBotAudit("delete_bot_admin", "telegram_user", target, { by: String(query.from.id) });
      return sendAdmins(chatId, actor);
    }
  } catch (error) {
    return tg("sendMessage", {
      chat_id: chatId,
      text: "تعذر تنفيذ العملية:\n" + shortText(error.message, 300),
    }).catch(() => {});
  }
}

async function processUpdate(update) {
  if (update.message?.text) return handleText(update.message);
  if (update.callback_query) return handleCallback(update.callback_query);
}

async function sendErrorAlerts() {
  if (!configured()) return;
  const rows = await errorRows("new", 10, true).catch(() => []);
  if (!rows?.length) return;

  const admins = await botAdminRows().catch(() => []);
  const recipients = new Set([ADMIN_ID]);
  for (const admin of admins || []) {
    if (admin.active && hasPermission(admin, "errors")) recipients.add(String(admin.telegram_user_id));
  }

  for (const row of rows) {
    const text = [
      "تنبيه خطأ في آشور",
      "",
      "الخدمة: " + row.service,
      row.code ? "الكود: " + row.code : "",
      "الخطأ: " + shortText(row.message, 250),
      "الوقت: " + new Date(row.created_at).toLocaleString("ar-IQ"),
    ].filter(Boolean).join("\n");

    let delivered = false;
    for (const chatId of recipients) {
      try {
        await tg("sendMessage", {
          chat_id: chatId,
          text,
          reply_markup: {
            inline_keyboard: [[
              { text: "أخطاء النظام", callback_data: "errors" },
              { text: "تمت المعالجة", callback_data: "resolve_error:" + row.id },
            ]],
          },
        });
        delivered = true;
      } catch {}
    }

    if (delivered) {
      await db("/rest/v1/system_errors?id=eq." + encodeURIComponent(row.id), {
        method: "PATCH",
        body: { bot_alerted_at: new Date().toISOString() },
        prefer: "return=minimal",
      }).catch(() => {});
    }
  }
}

async function poll() {
  if (polling || !configured()) return;
  polling = true;
  try {
    me = await tg("getMe");
    while (configured()) {
      try {
        const updates = await tg("getUpdates", {
          offset,
          timeout: 25,
          allowed_updates: ["message", "callback_query"],
        });
        for (const update of updates) {
          offset = Math.max(offset, update.update_id + 1);
          await processUpdate(update).catch((error) => {
            console.error("[ASHUR BOT UPDATE]", error);
          });
        }
      } catch (error) {
        console.error("[ASHUR BOT POLL]", error.message);
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    }
  } finally {
    polling = false;
  }
}

const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return res.end(JSON.stringify({
      ok: true,
      configured: configured(),
      polling,
      alerts: Boolean(alertTimer),
      bot: me?.username || null,
    }));
  }
  res.statusCode = 404;
  res.end("غير موجود");
});

server.listen(PORT, "0.0.0.0", () => {
  console.log("ASHUR storage bot listening on " + PORT);
  if (!configured()) {
    console.log("البوت بانتظار إضافة المتغيرات السرية.");
    return;
  }
  alertTimer = setInterval(() => sendErrorAlerts().catch(() => {}), 30_000);
  alertTimer.unref();
  sendErrorAlerts().catch(() => {});
  poll().catch((error) => console.error("[ASHUR BOT]", error));
});

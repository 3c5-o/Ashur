import http from "node:http";

const PORT = Number(process.env.PORT || 8080);
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const ADMIN_ID = String(process.env.TELEGRAM_ADMIN_ID || "");
const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

const channels = [
  ["profile_images", "آشور - صور الحسابات"],
  ["posts_media", "آشور - صور المنشورات"],
  ["reels", "آشور - مقاطع الريلز"],
  ["stories", "آشور - القصص"],
  ["chat_media", "آشور - وسائط المحادثات"],
  ["group_media", "آشور - وسائط المجموعات"],
  ["general_files", "آشور - الملفات العامة"],
  ["storage_logs", "آشور - سجل التخزين"],
  ["storage_errors", "آشور - أخطاء التخزين"],
  ["backups", "آشور - النسخ الاحتياطي"],
];

let offset = 0;
let me = null;
let polling = false;

function configured() {
  return Boolean(BOT_TOKEN && ADMIN_ID && SUPABASE_URL && SERVICE_KEY);
}

async function tg(method, body = {}) {
  if (!BOT_TOKEN) throw new Error("توكن البوت غير مضاف");
  const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
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
    Authorization: `Bearer ${SERVICE_KEY}`,
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (prefer) headers.Prefer = prefer;
  const response = await fetch(`${SUPABASE_URL}${path}`, {
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
  return db(`/rest/v1/${table}?on_conflict=${encodeURIComponent(onConflict)}`, {
    method: "POST",
    body,
    prefer: "resolution=merge-duplicates,return=representation",
  });
}

async function channelRows() {
  return db("/rest/v1/storage_channels?select=channel_key,channel_id,title,status,last_test_at,enabled");
}

async function pending(userId) {
  const rows = await db(
    `/rest/v1/bot_pending?select=*&telegram_user_id=eq.${encodeURIComponent(userId)}&limit=1`,
  );
  return rows?.[0] || null;
}

async function clearPending(userId) {
  await db(`/rest/v1/bot_pending?telegram_user_id=eq.${encodeURIComponent(userId)}`, {
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

function isAdmin(from) {
  return Boolean(from && String(from.id) === ADMIN_ID);
}

function mainKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "قنوات التخزين", callback_data: "channels" }],
      [
        { text: "حالة التخزين", callback_data: "status" },
        { text: "اختبار الكل", callback_data: "test_all" },
      ],
    ],
  };
}

async function sendMain(chatId, text = "لوحة تخزين آشور\n\nاختر العملية المطلوبة:") {
  return tg("sendMessage", {
    chat_id: chatId,
    text,
    reply_markup: mainKeyboard(),
  });
}

async function sendChannels(chatId, messageId = null) {
  const rows = await channelRows();
  const map = new Map((rows || []).map((x) => [x.channel_key, x]));
  const keyboard = channels.map(([key, title]) => {
    const linked = map.get(key)?.status === "connected" && map.get(key)?.enabled !== false;
    return [{
      text: `${linked ? "✅" : "▫️"} ${title}`,
      callback_data: `link:${key}`,
    }];
  });
  keyboard.push([{ text: "رجوع", callback_data: "home" }]);

  const body = {
    chat_id: chatId,
    text: "قنوات التخزين\n\nاضغط القناة التي تريد ربطها أو تغييرها:",
    reply_markup: { inline_keyboard: keyboard },
  };
  if (messageId) {
    return tg("editMessageText", { ...body, message_id: messageId });
  }
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

async function handleText(message) {
  const from = message.from;
  if (!isAdmin(from)) {
    return tg("sendMessage", {
      chat_id: message.chat.id,
      text: "هذا البوت مخصص لإدارة تخزين آشور.",
    }).catch(() => {});
  }

  const text = String(message.text || "").trim();
  if (text === "/start" || text === "/menu") {
    await clearPending(from.id).catch(() => {});
    return sendMain(message.chat.id);
  }
  if (text === "/cancel" || text === "إلغاء") {
    await clearPending(from.id).catch(() => {});
    return sendMain(message.chat.id, "تم إلغاء العملية.");
  }

  const p = await pending(from.id);
  if (!p || new Date(p.expires_at) <= new Date()) {
    if (p) await clearPending(from.id).catch(() => {});
    return sendMain(message.chat.id, "اختر العملية من القائمة.");
  }

  if (p.action === "link_channel") {
    if (!/^-100\d{5,}$/.test(text)) {
      return tg("sendMessage", {
        chat_id: message.chat.id,
        text: "المعرف غير صالح. أرسل معرف القناة الذي يبدأ بـ -100 أو أرسل /cancel للإلغاء.",
      });
    }

    const key = p.payload?.channel_key;
    const title = channels.find(([k]) => k === key)?.[1] || "القناة";
    await tg("sendMessage", {
      chat_id: message.chat.id,
      text: `جارٍ فحص ${title}...`,
    });

    try {
      const chat = await validateChannel(text);
      await saveChannel(from.id, key, text, chat);
      await clearPending(from.id);
      await tg("sendMessage", {
        chat_id: message.chat.id,
        text: `تم ربط ${title} بنجاح.\n\nمعرف القناة: ${text}`,
      });
      return sendMain(message.chat.id);
    } catch (error) {
      return tg("sendMessage", {
        chat_id: message.chat.id,
        text: `تعذر ربط القناة:\n${error.message}\n\nتأكد أن البوت مشرف وله صلاحية النشر والحذف.`,
      });
    }
  }
}

async function handleCallback(query) {
  if (!isAdmin(query.from)) {
    return tg("answerCallbackQuery", {
      callback_query_id: query.id,
      text: "غير مصرح",
      show_alert: true,
    });
  }

  await tg("answerCallbackQuery", { callback_query_id: query.id }).catch(() => {});
  const data = String(query.data || "");
  const chatId = query.message?.chat?.id;
  const messageId = query.message?.message_id;

  if (data === "home") {
    await clearPending(query.from.id).catch(() => {});
    return tg("editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text: "لوحة تخزين آشور\n\nاختر العملية المطلوبة:",
      reply_markup: mainKeyboard(),
    });
  }

  if (data === "channels") return sendChannels(chatId, messageId);

  if (data === "status") {
    const rows = await channelRows();
    const map = new Map((rows || []).map((x) => [x.channel_key, x]));
    const lines = channels.map(([key, title]) => {
      const row = map.get(key);
      const mark = row?.status === "connected" && row?.enabled !== false ? "✅" : "▫️";
      return `${mark} ${title}`;
    });
    return tg("sendMessage", {
      chat_id: chatId,
      text: `حالة تخزين آشور\n\n${lines.join("\n")}\n\nالمربوط: ${rows?.filter((x) => x.status === "connected" && x.enabled !== false).length || 0} من 10`,
      reply_markup: {
        inline_keyboard: [[{ text: "قنوات التخزين", callback_data: "channels" }]],
      },
    });
  }

  if (data === "test_all") {
    const rows = await channelRows();
    if (!rows?.length) {
      return tg("sendMessage", { chat_id: chatId, text: "لا توجد قنوات مربوطة بعد." });
    }
    let ok = 0;
    let failed = 0;
    for (const row of rows) {
      try {
        await validateChannel(row.channel_id);
        await db(`/rest/v1/storage_channels?channel_key=eq.${encodeURIComponent(row.channel_key)}`, {
          method: "PATCH",
          body: {
            status: "connected",
            last_test_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          prefer: "return=minimal",
        });
        ok++;
      } catch (error) {
        failed++;
        await db(`/rest/v1/storage_channels?channel_key=eq.${encodeURIComponent(row.channel_key)}`, {
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
    return tg("sendMessage", {
      chat_id: chatId,
      text: `اكتمل فحص القنوات.\n\nتعمل: ${ok}\nتحتاج مراجعة: ${failed}`,
    });
  }

  if (data.startsWith("link:")) {
    const key = data.slice(5);
    const channel = channels.find(([k]) => k === key);
    if (!channel) return;
    await setPending(query.from.id, "link_channel", { channel_key: key });
    return tg("sendMessage", {
      chat_id: chatId,
      text: `ربط ${channel[1]}\n\nأرسل الآن معرف القناة الذي يبدأ بـ -100.\n\nللإلغاء أرسل /cancel`,
    });
  }
}

async function processUpdate(update) {
  if (update.message?.text) return handleText(update.message);
  if (update.callback_query) return handleCallback(update.callback_query);
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
      bot: me?.username || null,
    }));
  }
  res.statusCode = 404;
  res.end("غير موجود");
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`ASHUR storage bot listening on ${PORT}`);
  if (!configured()) {
    console.log("البوت بانتظار إضافة المتغيرات السرية.");
  } else {
    poll().catch((error) => console.error("[ASHUR BOT]", error));
  }
});

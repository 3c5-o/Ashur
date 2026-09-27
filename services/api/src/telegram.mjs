import { TelegramClient } from "teleproto";
import { StringSession } from "teleproto/sessions/index.js";
import { config } from "./config.mjs";

let client = null;
let connectPromise = null;

export function telegramConfigured() {
  return Boolean(
    config.telegramBotToken &&
    config.telegramApiId &&
    config.telegramApiHash
  );
}

export async function telegramClient() {
  if (!telegramConfigured()) {
    throw new Error("بيانات تخزين تيليجرام غير مكتملة");
  }
  if (client?.connected) return client;
  if (connectPromise) return connectPromise;

  connectPromise = (async () => {
    const session = new StringSession(config.telegramSession || "");
    const next = new TelegramClient(
      session,
      config.telegramApiId,
      config.telegramApiHash,
      { connectionRetries: 5 },
    );
    await next.start({ botAuthToken: config.telegramBotToken });
    client = next;
    return next;
  })();

  try {
    return await connectPromise;
  } finally {
    connectPromise = null;
  }
}

export async function uploadToChannel({
  channelId,
  filePath,
  caption = "",
}) {
  const tg = await telegramClient();
  const message = await tg.sendFile(String(channelId), {
    file: filePath,
    caption,
    forceDocument: false,
  });

  const first = Array.isArray(message) ? message[0] : message;
  if (!first?.id) throw new Error("لم يرجع تيليجرام معرفًا للملف المرفوع");

  return {
    messageId: Number(first.id),
    storageRef: `message:${String(channelId)}:${String(first.id)}`,
  };
}

export async function downloadMessageMedia({
  channelId,
  messageId,
  outputFile,
}) {
  const tg = await telegramClient();
  const messages = await tg.getMessages(String(channelId), {
    ids: [Number(messageId)],
  });
  const message = Array.isArray(messages) ? messages[0] : messages;
  if (!message?.media) throw new Error("الملف غير موجود في قناة التخزين");

  await tg.downloadMedia(message, { outputFile });
  return outputFile;
}

export async function testTelegramConnection() {
  if (!telegramConfigured()) {
    return { ok: false, detail: "بيانات تيليجرام غير مضافة بعد" };
  }
  try {
    const tg = await telegramClient();
    const me = await tg.getMe();
    return {
      ok: true,
      detail: me?.username ? `متصل بالحساب @${me.username}` : "متصل",
    };
  } catch (error) {
    return { ok: false, detail: error.message };
  }
}

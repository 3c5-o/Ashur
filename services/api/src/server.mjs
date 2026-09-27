import http from "node:http";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

import { config, readiness } from "./config.mjs";
import {
  verifyUserToken,
  select,
  insert,
  update,
  remove,
  upsert,
  count,
} from "./supabase.mjs";
import {
  uploadToChannel,
  downloadMessageMedia,
  testTelegramConnection,
} from "./telegram.mjs";
import { sendPush, notificationsConfigured } from "./onesignal.mjs";

const cacheDir = path.join(os.tmpdir(), "ashur-media");
await fsp.mkdir(cacheDir, { recursive: true });

const CHANNELS = {
  profile: "profile_images",
  profile_cover: "profile_images",
  post_image: "posts_media",
  post_video: "posts_media",
  reel: "reels",
  story: "stories",
  chat_image: "chat_media",
  chat_video: "chat_media",
  chat_audio: "chat_media",
  group_media: "group_media",
  file: "general_files",
  backup: "backups",
};

const DEFAULT_LIMITS_MB = {
  profile: 10,
  profile_cover: 10,
  post_image: 10,
  post_video: 60,
  reel: 60,
  story: 30,
  chat_image: 10,
  chat_video: 50,
  chat_audio: 15,
  group_media: 60,
  file: 60,
  backup: 60,
};

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, X-File-Name, X-Requested-With");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges");
}

function json(res, status, body) {
  cors(res);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function bearer(req) {
  const value = req.headers.authorization || "";
  return value.startsWith("Bearer ") ? value.slice(7).trim() : "";
}

function mediaTicketKey() {
  if (!config.serviceRoleKey) throw new Error("لم يتم إعداد مفتاح الخادم");
  return crypto.createHash("sha256").update(config.serviceRoleKey).digest();
}

function createMediaTicket(mediaId, userId) {
  const expires = Math.floor(Date.now() / 1000) + config.mediaTicketMinutes * 60;
  const payload = `${mediaId}.${userId}.${expires}`;
  const signature = crypto
    .createHmac("sha256", mediaTicketKey())
    .update(payload)
    .digest("base64url");
  return `${userId}.${expires}.${signature}`;
}

function verifyMediaTicket(mediaId, ticket) {
  if (!ticket || !config.serviceRoleKey) return null;
  const [userId, expiresRaw, signature] = String(ticket).split(".");
  const expires = Number(expiresRaw);
  if (!userId || !Number.isFinite(expires) || !signature || expires < Math.floor(Date.now() / 1000)) {
    return null;
  }
  const payload = `${mediaId}.${userId}.${expires}`;
  const expected = crypto
    .createHmac("sha256", mediaTicketKey())
    .update(payload)
    .digest("base64url");
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return { id: userId };
}

async function currentUser(req, required = true) {
  const user = await verifyUserToken(bearer(req));
  if (!user && required) {
    const error = new Error("يجب تسجيل الدخول");
    error.statusCode = 401;
    throw error;
  }
  return user;
}

async function readJson(req, max = 1024 * 1024) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > max) {
      const error = new Error("حجم الطلب أكبر من المسموح");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const error = new Error("بيانات الطلب غير صالحة");
    error.statusCode = 400;
    throw error;
  }
}

async function adminFor(userId) {
  if (!userId) return null;
  if (config.ownerUserId && userId === config.ownerUserId) {
    return { user_id: userId, role: "owner", permissions: { all: true }, active: true };
  }
  const rows = await select(
    "admins",
    `select=user_id,role,permissions,active&user_id=eq.${encodeURIComponent(userId)}&active=eq.true&limit=1`,
  );
  return rows?.[0] || null;
}

async function requireAdmin(req, permission = null) {
  const user = await currentUser(req, true);
  const admin = await adminFor(user.id);
  if (!admin) {
    const error = new Error("لا تملك صلاحية الإدارة");
    error.statusCode = 403;
    throw error;
  }
  if (
    permission &&
    admin.role !== "owner" &&
    admin.role !== "secondary_admin" &&
    admin.permissions?.[permission] !== true
  ) {
    const error = new Error("هذه الصلاحية غير متاحة لهذا المشرف");
    error.statusCode = 403;
    throw error;
  }
  return { user, admin };
}

async function profileFor(userId) {
  const rows = await select(
    "profiles",
    `select=id,name,username,is_private,is_banned&limit=1&id=eq.${encodeURIComponent(userId)}`,
  );
  return rows?.[0] || null;
}

async function canViewOwner(user, ownerId) {
  const owner = await profileFor(ownerId);
  if (!owner || owner.is_banned) return false;
  if (!owner.is_private) return true;
  if (!user) return false;
  if (user.id === ownerId) return true;
  const follows = await select(
    "follows",
    `select=follower_id&follower_id=eq.${encodeURIComponent(user.id)}&following_id=eq.${encodeURIComponent(ownerId)}&status=eq.accepted&limit=1`,
  );
  return Boolean(follows?.length);
}

async function canReadMedia(user, media) {
  if (!media) return false;
  if (user?.id && media.owner_id === user.id) return true;

  if (media.kind === "profile" || media.kind === "profile_cover") {
    return canViewOwner(user, media.owner_id);
  }

  if (media.kind === "post_image" || media.kind === "post_video") {
    const links = await select(
      "post_media",
      `select=post_id&media_id=eq.${encodeURIComponent(media.id)}&limit=1`,
    );
    if (!links?.length) return false;
    const posts = await select(
      "posts",
      `select=author_id&id=eq.${encodeURIComponent(links[0].post_id)}&limit=1`,
    );
    return posts?.[0] ? canViewOwner(user, posts[0].author_id) : false;
  }

  if (media.kind === "reel") {
    const reels = await select(
      "reels",
      `select=author_id&media_id=eq.${encodeURIComponent(media.id)}&limit=1`,
    );
    return reels?.[0] ? canViewOwner(user, reels[0].author_id) : false;
  }

  if (media.kind === "story") {
    const stories = await select(
      "stories",
      `select=author_id,expires_at&media_id=eq.${encodeURIComponent(media.id)}&limit=1`,
    );
    if (!stories?.[0] || new Date(stories[0].expires_at) <= new Date()) return false;
    return canViewOwner(user, stories[0].author_id);
  }

  if (["chat_image", "chat_video", "chat_audio", "group_media"].includes(media.kind)) {
    if (!user) return false;
    const messages = await select(
      "messages",
      `select=conversation_id&media_id=eq.${encodeURIComponent(media.id)}&limit=1`,
    );
    if (!messages?.[0]) return false;
    const membership = await select(
      "conversation_members",
      `select=user_id&conversation_id=eq.${encodeURIComponent(messages[0].conversation_id)}&user_id=eq.${encodeURIComponent(user.id)}&limit=1`,
    );
    return Boolean(membership?.length);
  }

  return false;
}

async function setting(key) {
  const rows = await select(
    "app_settings",
    `select=value&key=eq.${encodeURIComponent(key)}&limit=1`,
  );
  return rows?.[0]?.value || {};
}

async function uploadLimitBytes(kind) {
  try {
    const limits = await setting("limits");
    const mapping = {
      profile: limits.image_mb,
      profile_cover: limits.image_mb,
      post_image: limits.image_mb,
      post_video: limits.max_upload_mb,
      reel: limits.max_upload_mb,
      story: limits.story_mb,
      chat_image: limits.image_mb,
      chat_video: limits.chat_video_mb,
      chat_audio: limits.audio_mb,
      group_media: limits.max_upload_mb,
      file: limits.max_upload_mb,
      backup: limits.max_upload_mb,
    };
    const mb = Number(mapping[kind] || DEFAULT_LIMITS_MB[kind] || 60);
    return Math.min(mb * 1024 * 1024, config.maxUploadBytes);
  } catch {
    return Math.min((DEFAULT_LIMITS_MB[kind] || 60) * 1024 * 1024, config.maxUploadBytes);
  }
}

async function receiveFile(req, maxBytes) {
  const id = crypto.randomUUID();
  const filePath = path.join(cacheDir, `upload-${id}.bin`);
  const stream = fs.createWriteStream(filePath, { flags: "wx" });
  const hash = crypto.createHash("sha256");
  let size = 0;

  try {
    for await (const chunk of req) {
      size += chunk.length;
      if (size > maxBytes) {
        const error = new Error("الملف أكبر من الحد المسموح");
        error.statusCode = 413;
        throw error;
      }
      hash.update(chunk);
      if (!stream.write(chunk)) {
        await new Promise((resolve) => stream.once("drain", resolve));
      }
    }
    await new Promise((resolve, reject) => stream.end((error) => error ? reject(error) : resolve()));
    return { filePath, size, sha256: hash.digest("hex") };
  } catch (error) {
    stream.destroy();
    await fsp.rm(filePath, { force: true }).catch(() => {});
    throw error;
  }
}

async function handleUpload(req, res, url) {
  const user = await currentUser(req);
  const profile = await profileFor(user.id);
  if (!profile || profile.is_banned) {
    const error = new Error("الحساب غير مسموح له بالرفع");
    error.statusCode = 403;
    throw error;
  }

  const kind = url.searchParams.get("kind") || "";
  const channelKey = CHANNELS[kind];
  if (!channelKey) {
    const error = new Error("نوع الملف غير مدعوم");
    error.statusCode = 400;
    throw error;
  }

  const channels = await select(
    "storage_channels",
    `select=*&channel_key=eq.${encodeURIComponent(channelKey)}&enabled=eq.true&status=eq.connected&limit=1`,
  );
  const channel = channels?.[0];
  if (!channel) {
    const error = new Error("قناة التخزين لهذا النوع غير مربوطة بعد");
    error.statusCode = 503;
    throw error;
  }

  const maxBytes = await uploadLimitBytes(kind);
  const declared = Number(req.headers["content-length"] || 0);
  if (declared && declared > maxBytes) {
    const error = new Error(`الحد الأقصى لهذا الملف ${Math.floor(maxBytes / 1024 / 1024)} ميغابايت`);
    error.statusCode = 413;
    throw error;
  }

  const originalName = decodeURIComponent(String(req.headers["x-file-name"] || "ملف"));
  const mimeType = String(req.headers["content-type"] || "application/octet-stream");
  const received = await receiveFile(req, maxBytes);

  try {
    const uploaded = await uploadToChannel({
      channelId: channel.channel_id,
      filePath: received.filePath,
      caption: `آشور · ${kind} · ${user.id}`,
    });

    const rows = await insert("media_objects", {
      owner_id: user.id,
      kind,
      channel_key: channelKey,
      telegram_message_id: uploaded.messageId,
      telegram_file_id: uploaded.storageRef,
      original_name: originalName.slice(0, 250),
      mime_type: mimeType.slice(0, 150),
      size_bytes: received.size,
      sha256: received.sha256,
      status: "ready",
    });

    await update(
      "storage_channels",
      `channel_key=eq.${encodeURIComponent(channelKey)}`,
      { last_upload_at: new Date().toISOString() },
      { returning: false },
    ).catch(() => {});

    json(res, 201, rows?.[0] || {});
  } finally {
    await fsp.rm(received.filePath, { force: true }).catch(() => {});
  }
}

async function ensureCachedMedia(media) {
  const ext = (() => {
    const name = media.original_name || "";
    const found = path.extname(name);
    return /^[.][a-zA-Z0-9]{1,8}$/.test(found) ? found : "";
  })();
  const filePath = path.join(cacheDir, `${media.id}${ext}`);

  try {
    const stat = await fsp.stat(filePath);
    if (stat.size > 0) return filePath;
  } catch {}

  const channels = await select(
    "storage_channels",
    `select=channel_id&channel_key=eq.${encodeURIComponent(media.channel_key)}&limit=1`,
  );
  if (!channels?.[0]) throw new Error("قناة الملف غير موجودة");

  const temp = `${filePath}.part-${crypto.randomUUID()}`;
  await downloadMessageMedia({
    channelId: channels[0].channel_id,
    messageId: media.telegram_message_id,
    outputFile: temp,
  });
  await fsp.rename(temp, filePath);
  return filePath;
}

async function issueMediaTicket(req, res, mediaId) {
  const user = await currentUser(req, true);
  const rows = await select(
    "media_objects",
    `select=*&id=eq.${encodeURIComponent(mediaId)}&status=eq.ready&limit=1`,
  );
  const media = rows?.[0];
  if (!media) return json(res, 404, { error: "الملف غير موجود" });
  if (!(await canReadMedia(user, media))) {
    return json(res, 403, { error: "لا تملك صلاحية مشاهدة هذا الملف" });
  }
  const ticket = createMediaTicket(mediaId, user.id);
  return json(res, 200, {
    path: `/v1/media/${mediaId}?ticket=${encodeURIComponent(ticket)}`,
    mime_type: media.mime_type || "application/octet-stream",
    original_name: media.original_name || "",
    expires_in_seconds: config.mediaTicketMinutes * 60,
  });
}

async function handleMedia(req, res, mediaId, url) {
  const rows = await select(
    "media_objects",
    `select=*&id=eq.${encodeURIComponent(mediaId)}&status=eq.ready&limit=1`,
  );
  const media = rows?.[0];
  if (!media) {
    json(res, 404, { error: "الملف غير موجود" });
    return;
  }

  const user =
    verifyMediaTicket(mediaId, url?.searchParams?.get("ticket")) ||
    await currentUser(req, false).catch(() => null);
  if (!(await canReadMedia(user, media))) {
    json(res, 403, { error: "لا تملك صلاحية مشاهدة هذا الملف" });
    return;
  }

  const filePath = await ensureCachedMedia(media);
  const stat = await fsp.stat(filePath);
  const size = stat.size;
  const range = req.headers.range;

  cors(res);
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Content-Type", media.mime_type || "application/octet-stream");
  res.setHeader("Cache-Control", media.kind.startsWith("chat_") ? "private, max-age=300" : "public, max-age=3600");

  if (!range) {
    res.statusCode = 200;
    res.setHeader("Content-Length", String(size));
    fs.createReadStream(filePath).pipe(res);
    return;
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match) {
    res.statusCode = 416;
    res.setHeader("Content-Range", `bytes */${size}`);
    res.end();
    return;
  }

  const start = match[1] ? Number(match[1]) : 0;
  const end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  if (start > end || start >= size) {
    res.statusCode = 416;
    res.setHeader("Content-Range", `bytes */${size}`);
    res.end();
    return;
  }

  res.statusCode = 206;
  res.setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
  res.setHeader("Content-Length", String(end - start + 1));
  fs.createReadStream(filePath, { start, end }).pipe(res);
}

async function listConversations(req, res) {
  const user = await currentUser(req);
  const memberships = await select(
    "conversation_members",
    `select=conversation_id,role,muted&user_id=eq.${encodeURIComponent(user.id)}&order=joined_at.desc&limit=100`,
  );
  if (!memberships?.length) return json(res, 200, { items: [] });

  const ids = memberships.map((x) => x.conversation_id);
  const idFilter = ids.join(",");
  const conversations = await select(
    "conversations",
    `select=id,kind,title,image_media_id,updated_at&id=in.(${idFilter})&order=updated_at.desc`,
  );

  const items = [];
  for (const conversation of conversations || []) {
    const messages = await select(
      "messages",
      `select=body,created_at&conversation_id=eq.${encodeURIComponent(conversation.id)}&is_deleted=eq.false&order=created_at.desc&limit=1`,
    );
    let title = conversation.title || "";
    if (!title && conversation.kind === "direct") {
      const members = await select(
        "conversation_members",
        `select=user_id&conversation_id=eq.${encodeURIComponent(conversation.id)}&user_id=neq.${encodeURIComponent(user.id)}&limit=1`,
      );
      if (members?.[0]) {
        const profile = await profileFor(members[0].user_id);
        title = profile?.name || profile?.username || "محادثة";
      }
    }
    items.push({
      ...conversation,
      title: title || "محادثة",
      last_message: messages?.[0]?.body || "",
    });
  }
  json(res, 200, { items });
}

async function createConversation(req, res) {
  const user = await currentUser(req);
  const body = await readJson(req);
  const kind = body.kind === "group" ? "group" : "direct";
  const requested = Array.isArray(body.member_ids)
    ? body.member_ids
    : body.target_user_id
      ? [body.target_user_id]
      : [];
  const memberIds = [...new Set([user.id, ...requested.filter(Boolean)])];

  if (kind === "direct" && memberIds.length !== 2) {
    const error = new Error("المحادثة الخاصة تحتاج مستخدمًا واحدًا");
    error.statusCode = 400;
    throw error;
  }
  if (kind === "group" && memberIds.length < 3) {
    const error = new Error("المجموعة تحتاج ثلاثة أعضاء على الأقل");
    error.statusCode = 400;
    throw error;
  }

  const created = await insert("conversations", {
    kind,
    title: kind === "group" ? String(body.title || "مجموعة").slice(0, 80) : "",
    created_by: user.id,
  });
  const conversation = created?.[0];
  const members = memberIds.map((id) => ({
    conversation_id: conversation.id,
    user_id: id,
    role: id === user.id ? "owner" : "member",
  }));
  await insert("conversation_members", members, { returning: false });
  json(res, 201, conversation);
}

async function adminStats(req, res) {
  await requireAdmin(req, "analytics");
  const [users, posts, reels, openReports, recent] = await Promise.all([
    count("profiles"),
    count("posts"),
    count("reels"),
    count("reports", "status=eq.open"),
    select("reports", "select=id,reason,target_type,status,created_at&order=created_at.desc&limit=6"),
  ]);
  json(res, 200, {
    users,
    posts,
    reels,
    open_reports: openReports,
    recent_reports: recent || [],
  });
}

async function adminUsers(req, res, url) {
  await requireAdmin(req, "users");
  const q = (url.searchParams.get("q") || "").trim().replace(/[,*()]/g, "");
  const query = q
    ? `select=id,name,username,is_banned,is_verified,is_private,created_at&or=(name.ilike.*${encodeURIComponent(q)}*,username.ilike.*${encodeURIComponent(q)}*,id.eq.${encodeURIComponent(q)})&order=created_at.desc&limit=50`
    : "select=id,name,username,is_banned,is_verified,is_private,created_at&order=created_at.desc&limit=50";
  const items = await select("profiles", query);
  json(res, 200, { items: items || [] });
}

async function setBan(req, res, userId) {
  const actor = await requireAdmin(req, "users");
  const body = await readJson(req);
  const banned = Boolean(body.banned);
  await update("profiles", `id=eq.${encodeURIComponent(userId)}`, { is_banned: banned }, { returning: false });
  await insert("audit_logs", {
    actor_user_id: actor.user.id,
    action: banned ? "ban_user" : "unban_user",
    target_type: "profile",
    target_id: userId,
    details: { reason: String(body.reason || "") },
  }, { returning: false });
  json(res, 200, { ok: true });
}

async function adminContent(req, res, url) {
  await requireAdmin(req, "content");
  const kind = url.searchParams.get("kind") || "posts";
  const table = ({ posts: "posts", reels: "reels", stories: "stories" })[kind];
  if (!table) return json(res, 400, { error: "نوع المحتوى غير صالح" });
  const fields = table === "stories"
    ? "id,author_id,caption,created_at,expires_at"
    : "id,author_id,caption,created_at";
  const items = await select(table, `select=${fields}&order=created_at.desc&limit=100`);
  json(res, 200, { items: items || [] });
}

async function deleteContent(req, res, kind, id) {
  const actor = await requireAdmin(req, "content");
  const table = ({ posts: "posts", reels: "reels", stories: "stories" })[kind];
  if (!table) return json(res, 400, { error: "نوع المحتوى غير صالح" });
  await remove(table, `id=eq.${encodeURIComponent(id)}`);
  await insert("audit_logs", {
    actor_user_id: actor.user.id,
    action: "delete_content",
    target_type: kind,
    target_id: id,
  }, { returning: false });
  json(res, 200, { ok: true });
}

async function adminReports(req, res) {
  await requireAdmin(req, "reports");
  const items = await select(
    "reports",
    "select=id,reporter_id,target_type,target_id,reason,details,status,created_at,resolved_at&order=created_at.desc&limit=100",
  );
  json(res, 200, { items: items || [] });
}

async function resolveReport(req, res, reportId) {
  const actor = await requireAdmin(req, "reports");
  await update(
    "reports",
    `id=eq.${encodeURIComponent(reportId)}`,
    { status: "resolved", resolved_at: new Date().toISOString() },
    { returning: false },
  );
  await insert("audit_logs", {
    actor_user_id: actor.user.id,
    action: "resolve_report",
    target_type: "report",
    target_id: reportId,
  }, { returning: false });
  json(res, 200, { ok: true });
}

async function adminAdmins(req, res) {
  await requireAdmin(req, "admins");
  const items = await select(
    "admins",
    "select=user_id,role,permissions,active,created_at,profiles(name,username)&order=created_at.asc",
  );
  json(res, 200, { items: items || [] });
}

async function adminAudit(req, res) {
  await requireAdmin(req, "admins");
  const items = await select(
    "audit_logs",
    "select=id,actor_user_id,actor_telegram_id,action,target_type,target_id,details,created_at&order=created_at.desc&limit=200",
  );
  json(res, 200, { items: items || [] });
}

async function adminChannels(req, res) {
  await requireAdmin(req, "storage");
  const items = await select(
    "storage_channels",
    "select=channel_key,channel_id,title,enabled,status,last_test_at,last_upload_at,updated_at&order=channel_key.asc",
  );
  json(res, 200, { items: items || [] });
}

async function appSettings(req, res) {
  await requireAdmin(req, "settings");
  if (req.method === "GET") {
    const rows = await select(
      "app_settings",
      "select=key,value&key=in.(version,maintenance,limits,features)",
    );
    return json(res, 200, Object.fromEntries((rows || []).map((x) => [x.key, x.value])));
  }
  const body = await readJson(req);
  for (const key of ["version", "maintenance", "limits", "features"]) {
    if (body[key] !== undefined) {
      await upsert("app_settings", {
        key,
        value: body[key],
        public_read: true,
        updated_at: new Date().toISOString(),
      }, "key");
    }
  }
  json(res, 200, { ok: true });
}

async function siteSettings(req, res) {
  await requireAdmin(req, "settings");
  if (req.method === "GET") {
    const rows = await select("site_settings", "select=key,value");
    return json(res, 200, Object.fromEntries((rows || []).map((x) => [x.key, x.value])));
  }
  const body = await readJson(req);
  for (const key of ["hero", "download"]) {
    if (body[key] !== undefined) {
      await upsert("site_settings", {
        key,
        value: body[key],
        updated_at: new Date().toISOString(),
      }, "key");
    }
  }
  json(res, 200, { ok: true });
}

async function sendAdminNotification(req, res) {
  const actor = await requireAdmin(req, "notifications");
  const body = await readJson(req);
  const title = String(body.title || "").trim().slice(0, 80);
  const message = String(body.body || "").trim().slice(0, 500);
  if (!title || !message) return json(res, 400, { error: "العنوان والنص مطلوبان" });

  if (body.audience === "user") {
    const userId = String(body.user_id || "").trim();
    if (!userId) return json(res, 400, { error: "معرف المستخدم مطلوب" });
    await insert("notifications", {
      user_id: userId,
      actor_id: actor.user.id,
      kind: "system",
      title,
      body: message,
    }, { returning: false });
    const push = await sendPush({
      userIds: [userId],
      title,
      body: message,
      data: { kind: "system" },
    });
    return json(res, 200, { ok: true, push });
  }

  const users = await select("profiles", "select=id&is_banned=eq.false&limit=10000");
  const rows = (users || []).map((x) => ({
    user_id: x.id,
    actor_id: actor.user.id,
    kind: "system",
    title,
    body: message,
  }));
  if (rows.length) await insert("notifications", rows, { returning: false });
  const push = await sendPush({
    all: true,
    title,
    body: message,
    data: { kind: "system" },
  });
  json(res, 200, { ok: true, push });
}

async function healthDetails(res) {
  const ready = readiness();
  let db = { ok: false, detail: "بانتظار إضافة مفتاح الخادم" };
  if (ready.database) {
    try {
      await select("app_settings", "select=key&limit=1");
      db = { ok: true, detail: "متصلة" };
    } catch (error) {
      db = { ok: false, detail: error.message };
    }
  }

  const tg = await testTelegramConnection();
  json(res, 200, {
    status: ready.database ? "running" : "setup_required",
    services: {
      api: { ok: true, label: "بوابة آشور", detail: "تعمل" },
      database: { ...db, label: "قاعدة البيانات" },
      telegram: { ...tg, label: "تخزين تيليجرام" },
      notifications: {
        ok: notificationsConfigured(),
        label: "الإشعارات",
        detail: notificationsConfigured() ? "مهيأة" : "بانتظار بيانات ون سيغنال",
      },
    },
  });
}

async function processNotificationOutbox() {
  if (!readiness().database || !notificationsConfigured()) return;
  let items = [];
  try {
    items = await select(
      "notification_outbox",
      "select=id,user_id,notification_id,title,body,kind,data,attempts&processed_at=is.null&attempts=lt.5&order=created_at.asc&limit=40",
    );
  } catch {
    return;
  }

  for (const item of items || []) {
    try {
      await sendPush({
        userIds: [item.user_id],
        title: item.title,
        body: item.body,
        data: item.data || { kind: item.kind },
        idempotencyKey: item.notification_id || undefined,
      });
      await update(
        "notification_outbox",
        `id=eq.${item.id}`,
        {
          processed_at: new Date().toISOString(),
          attempts: Number(item.attempts || 0) + 1,
          last_error: null,
        },
        { returning: false },
      );
    } catch (error) {
      await update(
        "notification_outbox",
        `id=eq.${item.id}`,
        {
          attempts: Number(item.attempts || 0) + 1,
          last_error: String(error.message || error).slice(0, 1000),
        },
        { returning: false },
      ).catch(() => {});
    }
  }
}

async function cleanupCache() {
  const cutoff = Date.now() - config.cacheMinutes * 60_000;
  const names = await fsp.readdir(cacheDir).catch(() => []);
  for (const name of names) {
    const file = path.join(cacheDir, name);
    try {
      const stat = await fsp.stat(file);
      if (stat.mtimeMs < cutoff) await fsp.rm(file, { force: true });
    } catch {}
  }
}

const server = http.createServer(async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    return res.end();
  }

  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  try {
    if (req.method === "GET" && url.pathname === "/health") {
      return json(res, 200, { ok: true, readiness: readiness() });
    }
    if (req.method === "GET" && url.pathname === "/health/details") {
      return healthDetails(res);
    }

    if (req.method === "POST" && url.pathname === "/v1/storage/upload") {
      return handleUpload(req, res, url);
    }

    const ticketMatch = /^\/v1\/media-ticket\/([0-9a-f-]{36})$/.exec(url.pathname);
    if (req.method === "GET" && ticketMatch) {
      return issueMediaTicket(req, res, ticketMatch[1]);
    }

    const mediaMatch = /^\/v1\/media\/([0-9a-f-]{36})$/.exec(url.pathname);
    if (req.method === "GET" && mediaMatch) {
      return handleMedia(req, res, mediaMatch[1], url);
    }

    if (url.pathname === "/v1/conversations") {
      if (req.method === "GET") return listConversations(req, res);
      if (req.method === "POST") return createConversation(req, res);
    }

    if (req.method === "GET" && url.pathname === "/v1/admin/me") {
      const result = await requireAdmin(req);
      return json(res, 200, {
        id: result.user.id,
        role: result.admin.role,
        permissions: result.admin.permissions || {},
      });
    }
    if (req.method === "GET" && url.pathname === "/v1/admin/stats") {
      return adminStats(req, res);
    }
    if (req.method === "GET" && url.pathname === "/v1/admin/users") {
      return adminUsers(req, res, url);
    }

    const banMatch = /^\/v1\/admin\/users\/([0-9a-f-]{36})\/ban$/.exec(url.pathname);
    if (req.method === "POST" && banMatch) {
      return setBan(req, res, banMatch[1]);
    }

    if (req.method === "GET" && url.pathname === "/v1/admin/content") {
      return adminContent(req, res, url);
    }
    const contentMatch = /^\/v1\/admin\/content\/(posts|reels|stories)\/([0-9a-f-]{36})$/.exec(url.pathname);
    if (req.method === "DELETE" && contentMatch) {
      return deleteContent(req, res, contentMatch[1], contentMatch[2]);
    }

    if (req.method === "GET" && url.pathname === "/v1/admin/reports") {
      return adminReports(req, res);
    }
    const reportMatch = /^\/v1\/admin\/reports\/([0-9a-f-]{36})\/resolve$/.exec(url.pathname);
    if (req.method === "POST" && reportMatch) {
      return resolveReport(req, res, reportMatch[1]);
    }

    if (req.method === "GET" && url.pathname === "/v1/admin/channels") {
      return adminChannels(req, res);
    }
    if (req.method === "GET" && url.pathname === "/v1/admin/admins") {
      return adminAdmins(req, res);
    }
    if (req.method === "GET" && url.pathname === "/v1/admin/audit") {
      return adminAudit(req, res);
    }
    if (url.pathname === "/v1/admin/settings/app" && ["GET", "PUT"].includes(req.method)) {
      return appSettings(req, res);
    }
    if (url.pathname === "/v1/admin/settings/site" && ["GET", "PUT"].includes(req.method)) {
      return siteSettings(req, res);
    }
    if (req.method === "POST" && url.pathname === "/v1/admin/notifications/send") {
      return sendAdminNotification(req, res);
    }

    json(res, 404, { error: "المسار غير موجود" });
  } catch (error) {
    console.error("[ASHUR]", error);
    json(res, error.statusCode || 500, {
      error: error.statusCode ? error.message : "حدث خطأ في الخادم",
    });
  }
});

server.listen(config.port, "0.0.0.0", () => {
  console.log(`ASHUR listening on ${config.port}`);
  console.log("Readiness:", readiness());
});

const worker = setInterval(() => processNotificationOutbox().catch(() => {}), 5000);
worker.unref();
const cleaner = setInterval(() => cleanupCache().catch(() => {}), 10 * 60_000);
cleaner.unref();

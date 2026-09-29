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
  serviceRequest,
} from "./supabase.mjs";
import {
  uploadToChannel,
  downloadMessageMedia,
  deleteChannelMessage,
  testTelegramConnection,
  testTelegramChannel,
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
  reel_cover: "reels",
  story: "stories",
  chat_image: "chat_media",
  chat_video: "chat_media",
  chat_audio: "chat_media",
  chat_file: "chat_media",
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
  reel_cover: 10,
  story: 30,
  chat_image: 10,
  chat_video: 50,
  chat_audio: 15,
  chat_file: 50,
  group_media: 60,
  file: 60,
  backup: 60,
};

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, X-File-Name, X-Upload-Id, X-Requested-With");
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
  if (user) {
    const profile = await profileFor(user.id).catch(() => null);
    if (profile) {
      const until = profile.banned_until ? new Date(profile.banned_until) : null;
      if (until && until <= new Date()) {
        await update("profiles", "id=eq." + encodeURIComponent(user.id), {
          is_banned: false,
          banned_until: null,
          ban_reason: "",
        }, { returning: false }).catch(() => {});
        profile.is_banned = false;
        profile.banned_until = null;
        profile.ban_reason = "";
      }
      if (profileIsBanned(profile)) {
        const error = new Error(profile.deleted_at ? "هذا الحساب معطل" : "هذا الحساب موقوف");
        error.statusCode = 403;
        throw error;
      }
    }
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

  const rows = await select(
    "admins",
    `select=user_id,role,permissions,active&user_id=eq.${encodeURIComponent(userId)}&active=eq.true&limit=1`,
  ).catch(() => []);
  if (rows?.[0]) return rows[0];

  if (config.ownerUserId && userId === config.ownerUserId) {
    const activeOwners = await select(
      "admins",
      "select=user_id&role=eq.owner&active=eq.true&limit=1",
    ).catch(() => []);
    if (!activeOwners?.length) {
      const owner = { user_id: userId, role: "owner", permissions: {}, active: true };
      await upsert("admins", {
        user_id: userId,
        role: "owner",
        permissions: {},
        active: true,
        updated_at: new Date().toISOString(),
        last_active_at: new Date().toISOString(),
      }, "user_id").catch(() => {});
      return owner;
    }
  }

  return null;
}

const ADMIN_PERMISSION_KEYS = [
  "analytics",
  "users",
  "content",
  "reports",
  "support",
  "storage",
  "notifications",
  "admins",
  "settings",
];

const ADMIN_ROLE_PERMISSIONS = {
  moderator: new Set(["analytics", "users", "reports"]),
  content_moderator: new Set(["analytics", "content", "reports"]),
  support: new Set(["analytics", "support", "users"]),
  analyst: new Set(["analytics"]),
};

function sanitizeAdminPermissions(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const result = {};
  for (const key of ADMIN_PERMISSION_KEYS) {
    if (source[key] === true || source[key] === false) result[key] = source[key];
  }
  return result;
}

function adminHasPermission(admin, permission) {
  if (!admin || !admin.active) return false;
  if (!permission) return true;
  if (admin.role === "owner" || admin.role === "secondary_admin") return true;
  if (permission === "admins") return false;
  if (permission === "analytics") return true;
  if (admin.permissions?.[permission] === true) return true;
  if (admin.permissions?.[permission] === false) return false;
  return ADMIN_ROLE_PERMISSIONS[admin.role]?.has(permission) || false;
}

function effectiveAdminPermissions(admin) {
  return Object.fromEntries(ADMIN_PERMISSION_KEYS.map((key) => [key, adminHasPermission(admin, key)]));
}

async function requireAdmin(req, permission = null) {
  const user = await currentUser(req, true);
  const admin = await adminFor(user.id);
  if (!admin) {
    const error = new Error("لا تملك صلاحية الإدارة");
    error.statusCode = 403;
    throw error;
  }
  if (!adminHasPermission(admin, permission)) {
    const error = new Error("هذه الصلاحية غير متاحة لهذا المشرف");
    error.statusCode = 403;
    throw error;
  }
  await update(
    "admins",
    "user_id=eq." + encodeURIComponent(user.id),
    { last_active_at: new Date().toISOString() },
    { returning: false },
  ).catch(() => {});
  return { user, admin };
}

async function profileFor(userId) {
  const rows = await select(
    "profiles",
    `select=id,name,username,is_private,is_banned,banned_until,ban_reason,warning_count,deleted_at,saved_visibility&limit=1&id=eq.${encodeURIComponent(userId)}`,
  );
  return rows?.[0] || null;
}

async function isBlockedBetween(userId, otherId) {
  if (!userId || !otherId || userId === otherId) return false;
  const rows = await select(
    "blocks",
    "select=blocker_id&or=(and(blocker_id.eq." + encodeURIComponent(userId) + ",blocked_id.eq." + encodeURIComponent(otherId) + "),and(blocker_id.eq." + encodeURIComponent(otherId) + ",blocked_id.eq." + encodeURIComponent(userId) + "))&limit=1",
  ).catch(() => []);
  return Boolean(rows?.length);
}

function profileIsBanned(profile) {
  if (!profile) return true;
  if (profile.deleted_at) return true;
  if (profile.banned_until) return new Date(profile.banned_until) > new Date();
  return Boolean(profile.is_banned);
}

async function canViewOwner(user, ownerId) {
  const owner = await profileFor(ownerId);
  if (profileIsBanned(owner)) return false;
  if (user?.id && await isBlockedBetween(user.id, ownerId)) return false;
  if (!owner.is_private) return true;
  if (!user) return false;
  if (user.id === ownerId) return true;
  const follows = await select(
    "follows",
    `select=follower_id&follower_id=eq.${encodeURIComponent(user.id)}&following_id=eq.${encodeURIComponent(ownerId)}&status=eq.accepted&limit=1`,
  );
  return Boolean(follows?.length);
}

async function isAcceptedFollower(userId, ownerId) {
  if (!userId || !ownerId) return false;
  if (userId === ownerId) return true;
  const rows = await select(
    "follows",
    "select=status&follower_id=eq." + encodeURIComponent(userId) +
      "&following_id=eq." + encodeURIComponent(ownerId) +
      "&status=eq.accepted&limit=1",
  ).catch(() => []);
  return Boolean(rows?.length);
}

async function canViewContentOwner(user, ownerId, visibility = "public") {
  if (!ownerId) return false;
  if (user?.id === ownerId) return true;
  const owner = await profileFor(ownerId);
  if (profileIsBanned(owner)) return false;
  if (user?.id && await isBlockedBetween(user.id, ownerId)) return false;
  if (!owner.is_private && visibility === "public") return true;
  if (!user) return false;
  const rows = await select(
    "follows",
    "select=status&follower_id=eq." + encodeURIComponent(user.id) +
      "&following_id=eq." + encodeURIComponent(ownerId) +
      "&status=eq.accepted&limit=1",
  );
  return Boolean(rows?.length);
}

async function canReadMedia(user, media) {
  if (!media) return false;
  if (user?.id && media.owner_id === user.id) return true;
  if (user?.id) {
    const adminRows = await select(
      "admins",
      "select=user_id&user_id=eq." + encodeURIComponent(user.id) + "&active=eq.true&limit=1",
    ).catch(() => []);
    if (adminRows?.length) return true;
  }

  if (media.kind === "profile" || media.kind === "profile_cover") {
    return canViewOwner(user, media.owner_id);
  }

  if (media.kind === "post_image" || media.kind === "post_video") {
    const links = await select(
      "post_media",
      `select=post_id&media_id=eq.${encodeURIComponent(media.id)}&limit=50`,
    );
    if (!links?.length) return false;
    for (const link of links) {
      const posts = await select(
        "posts",
        `select=author_id,visibility,moderation_status,deleted_at&id=eq.${encodeURIComponent(link.post_id)}&limit=1`,
      );
      const post = posts?.[0];
      if (!post || post.deleted_at || post.moderation_status !== "active") continue;
      if (await canViewContentOwner(user, post.author_id, post.visibility || "public")) return true;
    }
    return false;
  }

  if (media.kind === "reel") {
    const reels = await select(
      "reels",
      `select=author_id,visibility,moderation_status,deleted_at&media_id=eq.${encodeURIComponent(media.id)}&limit=50`,
    );
    for (const reel of reels || []) {
      if (!reel || reel.deleted_at || reel.moderation_status !== "active") continue;
      if (await canViewContentOwner(user, reel.author_id, reel.visibility || "public")) return true;
    }
    return false;
  }

  if (media.kind === "reel_cover") {
    const reels = await select(
      "reels",
      `select=author_id,visibility,moderation_status,deleted_at&cover_media_id=eq.${encodeURIComponent(media.id)}&limit=50`,
    );
    for (const reel of reels || []) {
      if (!reel || reel.deleted_at || reel.moderation_status !== "active") continue;
      if (await canViewContentOwner(user, reel.author_id, reel.visibility || "public")) return true;
    }
    return false;
  }

  if (media.kind === "story") {
    const stories = await select(
      "stories",
      `select=author_id,expires_at,moderation_status,deleted_at&media_id=eq.${encodeURIComponent(media.id)}&limit=50`,
    );
    for (const story of stories || []) {
      if (!story || story.deleted_at || story.moderation_status !== "active") continue;
      if (new Date(story.expires_at) <= new Date()) continue;
      if (user?.id === story.author_id || await isAcceptedFollower(user?.id, story.author_id)) return true;
    }
    return false;
  }

  if (media.kind === "group_media") {
    if (!user) return false;
    const conversations = await select(
      "conversations",
      `select=id&image_media_id=eq.${encodeURIComponent(media.id)}&is_deleted=eq.false&limit=1`,
    );
    if (!conversations?.[0]) return false;
    const membership = await select(
      "conversation_members",
      `select=user_id&conversation_id=eq.${encodeURIComponent(conversations[0].id)}&user_id=eq.${encodeURIComponent(user.id)}&limit=1`,
    );
    return Boolean(membership?.length);
  }

  if (["chat_image", "chat_video", "chat_audio", "chat_file"].includes(media.kind)) {
    if (!user) return false;
    const messages = await select(
      "messages",
      `select=conversation_id&media_id=eq.${encodeURIComponent(media.id)}&is_deleted=eq.false&limit=1`,
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

async function featureEnabled(key) {
  const features = await setting("features").catch(() => ({}));
  return features?.[key] !== false;
}

async function requireFeature(key, label = "هذه الميزة") {
  if (await featureEnabled(key)) return;
  const error = new Error(label + " متوقفة مؤقتًا من إدارة آشور");
  error.statusCode = 503;
  throw error;
}

async function currentAppSettingsSnapshot() {
  const rows = await select(
    "app_settings",
    "select=key,value&key=in.(version,maintenance,limits,features)",
  );
  return Object.fromEntries((rows || []).map((row) => [row.key, row.value || {}]));
}

async function saveAppSettingsSnapshot(actorUserId, source = "admin", reason = "") {
  const snapshot = await currentAppSettingsSnapshot();
  const rows = await insert("app_settings_history", {
    actor_user_id: actorUserId || null,
    source: String(source || "admin").slice(0, 60),
    reason: String(reason || "").slice(0, 500),
    snapshot,
  });
  return rows?.[0] || null;
}

function validReleaseVersion(value) {
  return /^\d+(?:\.\d+){1,3}(?:[-+][0-9A-Za-z.-]+)?$/.test(String(value || "").trim());
}

function validHttpUrl(value) {
  if (!value) return true;
  try {
    const parsed = new URL(String(value));
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function validSha256(value) {
  return /^[a-f0-9]{64}$/i.test(String(value || "").trim());
}

async function syncPublishedRelease(release, actorUserId) {
  if (!release?.id) throw new Error("الإصدار غير موجود");
  if (!validReleaseVersion(release.version)) {
    const error = new Error("صيغة رقم الإصدار غير صالحة");
    error.statusCode = 400;
    throw error;
  }
  if (!validHttpUrl(release.download_url) || !release.download_url) {
    const error = new Error("رابط APK صالح مطلوب قبل النشر");
    error.statusCode = 400;
    throw error;
  }
  if (!validSha256(release.sha256)) {
    const error = new Error("SHA-256 مكوّن من 64 خانة مطلوب قبل النشر");
    error.statusCode = 400;
    throw error;
  }

  await saveAppSettingsSnapshot(actorUserId, "release_publish", "قبل نشر الإصدار " + release.version);

  const currentVersion = await setting("version").catch(() => ({}));
  const nextVersion = {
    ...currentVersion,
    latest: release.version,
    version_code: Number(release.version_code || 0),
    minimum: release.minimum_version || release.version,
    download_url: release.download_url,
    sha256: String(release.sha256 || "").toLowerCase(),
    message: release.update_message || release.notes || ("يتوفر الإصدار " + release.version + " من آشور."),
    required: Boolean(release.required),
    published_at: new Date().toISOString(),
  };
  await upsert("app_settings", {
    key: "version",
    value: nextVersion,
    public_read: true,
    updated_at: new Date().toISOString(),
  }, "key");

  const downloadRows = await select(
    "site_settings",
    "select=value&key=eq.download&limit=1",
  ).catch(() => []);
  const currentDownload = downloadRows?.[0]?.value || {};
  await upsert("site_settings", {
    key: "download",
    value: {
      ...currentDownload,
      version: release.version,
      android_url: release.download_url,
      download_url: release.download_url,
      sha256: String(release.sha256 || "").toLowerCase(),
      updated_at: new Date().toISOString(),
    },
    updated_at: new Date().toISOString(),
  }, "key");

  await update(
    "app_releases",
    "status=eq.published&id=neq." + encodeURIComponent(release.id),
    { status: "retired", updated_at: new Date().toISOString(), updated_by: actorUserId || null },
    { returning: false },
  ).catch(() => {});

  const now = new Date().toISOString();
  await update("app_releases", "id=eq." + encodeURIComponent(release.id), {
    status: "published",
    published_at: now,
    published_by: actorUserId || null,
    updated_by: actorUserId || null,
    updated_at: now,
  }, { returning: false });

  await writeAudit(actorUserId, "publish_release", "app_release", release.id, {
    version: release.version,
    version_code: release.version_code,
    minimum_version: release.minimum_version || release.version,
    required: Boolean(release.required),
    sha256: String(release.sha256 || "").toLowerCase(),
  });
}


async function writeAudit(actorUserId, action, targetType = null, targetId = null, details = {}) {
  let actorRole = null;
  let actorName = null;
  let actorUsername = null;
  if (actorUserId) {
    const [profiles, admins] = await Promise.all([
      select("profiles", "select=id,name,username&id=eq." + encodeURIComponent(actorUserId) + "&limit=1").catch(() => []),
      select("admins", "select=user_id,role&user_id=eq." + encodeURIComponent(actorUserId) + "&limit=1").catch(() => []),
    ]);
    actorName = profiles?.[0]?.name || null;
    actorUsername = profiles?.[0]?.username || null;
    actorRole = admins?.[0]?.role || null;
  }
  return insert("audit_logs", {
    actor_user_id: actorUserId || null,
    actor_role: actorRole,
    actor_name: actorName,
    actor_username: actorUsername,
    action,
    target_type: targetType,
    target_id: targetId == null ? null : String(targetId),
    details: details || {},
  }, { returning: false }).catch(() => {});
}

async function logSystemError(service, error, context = {}, userId = null) {
  const serviceName = String(service || "api").slice(0, 80);
  const code = String(error?.code || error?.statusCode || "").slice(0, 80);
  const message = String(error?.message || error || "Unknown error").slice(0, 1500);
  const statusCode = Number(error?.statusCode || error?.status || 0);
  const severity =
    statusCode >= 500 && /database|telegram|storage|upload|auth/i.test(serviceName) ? "critical" :
    statusCode >= 500 ? "error" :
    statusCode >= 400 ? "warning" : "error";
  const fingerprint = crypto
    .createHash("sha256")
    .update([serviceName, code, message].join("|"))
    .digest("hex");
  const now = new Date().toISOString();

  const existing = await select(
    "system_errors",
    "select=id,occurrence_count&fingerprint=eq." + encodeURIComponent(fingerprint) +
      "&status=neq.resolved&order=last_seen_at.desc.nullslast,created_at.desc&limit=1",
  ).catch(() => []);

  if (existing?.[0]) {
    return update("system_errors", "id=eq." + encodeURIComponent(existing[0].id), {
      service: serviceName,
      code,
      message,
      severity,
      context: context || {},
      user_id: userId || null,
      occurrence_count: Math.max(1, Number(existing[0].occurrence_count || 1)) + 1,
      last_seen_at: now,
      updated_at: now,
    }, { returning: false }).catch(() => {});
  }

  return insert("system_errors", {
    service: serviceName,
    code,
    message,
    severity,
    fingerprint,
    context: context || {},
    user_id: userId || null,
    occurrence_count: 1,
    first_seen_at: now,
    last_seen_at: now,
    updated_at: now,
  }, { returning: false }).catch(() => {});
}

async function uploadLimitBytes(kind) {
  try {
    const limits = await setting("limits");
    const mapping = {
      profile: limits.image_mb,
      profile_cover: limits.image_mb,
      post_image: limits.image_mb,
      post_video: limits.max_upload_mb,
      reel: limits.reel_mb || limits.max_upload_mb,
      reel_cover: limits.image_mb,
      story: limits.story_mb,
      chat_image: limits.image_mb,
      chat_video: limits.chat_video_mb,
      chat_audio: limits.audio_mb,
      chat_file: limits.chat_video_mb || limits.max_upload_mb,
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

async function receiveFile(req, maxBytes, jobId = null) {
  const id = crypto.randomUUID();
  const filePath = path.join(cacheDir, "upload-" + id + ".bin");
  const stream = fs.createWriteStream(filePath, { flags: "wx" });
  const hash = crypto.createHash("sha256");
  let size = 0;
  let lastProgress = 0;

  const syncProgress = async (force = false) => {
    if (!jobId) return;
    if (!force && size - lastProgress < 4 * 1024 * 1024) return;
    lastProgress = size;
    await update(
      "upload_jobs",
      "id=eq." + encodeURIComponent(jobId),
      { received_bytes: size, status: "receiving", updated_at: new Date().toISOString() },
      { returning: false },
    ).catch(() => {});
    const rows = await select(
      "upload_jobs",
      "select=cancel_requested&id=eq." + encodeURIComponent(jobId) + "&limit=1",
    ).catch(() => []);
    if (rows?.[0]?.cancel_requested) {
      const error = new Error("تم إلغاء الرفع");
      error.statusCode = 499;
      throw error;
    }
  };

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
      await syncProgress(false);
    }
    await syncProgress(true);
    await new Promise((resolve, reject) => stream.end((error) => error ? reject(error) : resolve()));
    return { filePath, size, sha256: hash.digest("hex") };
  } catch (error) {
    stream.destroy();
    await fsp.rm(filePath, { force: true }).catch(() => {});
    throw error;
  }
}

async function detectProfileImageMime(filePath) {
  const handle = await fsp.open(filePath, "r");
  try {
    const buffer = Buffer.alloc(32);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const b = buffer.subarray(0, bytesRead);

    if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
      return "image/jpeg";
    }
    if (
      b.length >= 8 &&
      b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
      b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a
    ) {
      return "image/png";
    }
    if (
      b.length >= 12 &&
      b.subarray(0, 4).toString("ascii") === "RIFF" &&
      b.subarray(8, 12).toString("ascii") === "WEBP"
    ) {
      return "image/webp";
    }
    if (b.length >= 12 && b.subarray(4, 8).toString("ascii") === "ftyp") {
      const brand = b.subarray(8, 12).toString("ascii");
      if (brand === "avif" || brand === "avis") return "image/avif";
    }
    return "";
  } finally {
    await handle.close();
  }
}

function retryUploadCachePath(jobId) {
  return path.join(cacheDir, "retry-upload-" + String(jobId) + ".bin");
}

function uploadRetryExpiry() {
  const minutes = Math.max(15, Number(config.cacheMinutes || 60));
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

async function handleUpload(req, res, url) {
  const user = await currentUser(req);
  await requireFeature("uploads", "رفع الملفات");
  const profile = await profileFor(user.id);
  if (profileIsBanned(profile)) {
    const error = new Error("الحساب غير مسموح له بالرفع");
    error.statusCode = 403;
    throw error;
  }

  const kind = url.searchParams.get("kind") || "";
  if (kind === "reel") await requireFeature("reels", "الريلز");
  if (kind === "story") await requireFeature("stories", "القصص");
  if (kind.startsWith("chat_")) await requireFeature("messages", "الرسائل");
  if (kind === "group_media") await requireFeature("groups", "المجموعات");
  const channelKey = CHANNELS[kind];
  if (!channelKey) {
    const error = new Error("نوع الملف غير مدعوم");
    error.statusCode = 400;
    throw error;
  }

  const channels = await select(
    "storage_channels",
    "select=*&channel_key=eq." + encodeURIComponent(channelKey) + "&enabled=eq.true&status=eq.connected&limit=1",
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
    const error = new Error("الحد الأقصى لهذا الملف " + Math.floor(maxBytes / 1024 / 1024) + " ميغابايت");
    error.statusCode = 413;
    throw error;
  }

  const originalName = decodeURIComponent(String(req.headers["x-file-name"] || "ملف"));
  const mimeType = String(req.headers["content-type"] || "application/octet-stream");
  const clientUploadId = String(req.headers["x-upload-id"] || crypto.randomUUID()).slice(0, 120);
  const isProfileImage = kind === "profile" || kind === "profile_cover";

  let verifiedMimeType = mimeType;
  let job = null;
  let received = null;
  let uploadStage = "receiving";
  let keepRetryFile = false;
  let telegramUpload = null;
  let mediaCreated = false;
  try {
    const existingJobs = await select(
      "upload_jobs",
      "select=*&client_upload_id=eq." + encodeURIComponent(clientUploadId) + "&user_id=eq." + encodeURIComponent(user.id) + "&limit=1",
    ).catch(() => []);
    job = existingJobs?.[0] || null;

    if (job?.status === "completed" && job.media_id) {
      const mediaRows = await select(
        "media_objects",
        "select=*&id=eq." + encodeURIComponent(job.media_id) + "&status=eq.ready&limit=1",
      ).catch(() => []);
      if (mediaRows?.[0]) {
        return json(res, 200, { ...mediaRows[0], reused: true, upload_job_id: job.id });
      }
    }

    if (!job) {
      const jobs = await insert("upload_jobs", {
        client_upload_id: clientUploadId,
        user_id: user.id,
        kind,
        original_name: originalName.slice(0, 250),
        mime_type: mimeType.slice(0, 150),
        size_bytes: declared || 0,
        received_bytes: 0,
        status: "queued",
        failure_stage: "",
        retry_available: false,
        retry_expires_at: null,
        attempt_count: 1,
      });
      job = jobs?.[0] || null;
    } else {
      await update(
        "upload_jobs",
        "id=eq." + encodeURIComponent(job.id),
        {
          kind,
          original_name: originalName.slice(0, 250),
          size_bytes: declared || job.size_bytes || 0,
          received_bytes: 0,
          status: "queued",
          error: null,
          mime_type: mimeType.slice(0, 150),
          sha256: "",
          failure_stage: "",
          retry_available: false,
          retry_expires_at: null,
          cancel_requested: false,
          attempt_count: Math.max(1, Number(job.attempt_count || 1) + 1),
          updated_at: new Date().toISOString(),
          completed_at: null,
        },
        { returning: false },
      );
    }

    received = await receiveFile(req, maxBytes, job?.id || null);
    uploadStage = "validating";

    if (isProfileImage) {
      const detectedMime = await detectProfileImageMime(received.filePath);
      if (!detectedMime) {
        const error = new Error("صيغة صورة الحساب غير مدعومة. استخدم JPG أو PNG أو WebP أو AVIF");
        error.statusCode = 415;
        throw error;
      }
      verifiedMimeType = detectedMime;
    }

    uploadStage = "storing";
    if (job?.id) {
      await update(
        "upload_jobs",
        "id=eq." + encodeURIComponent(job.id),
        {
          size_bytes: received.size,
          received_bytes: received.size,
          mime_type: verifiedMimeType.slice(0, 150),
          sha256: received.sha256,
          status: "storing",
          failure_stage: "",
          retry_available: false,
          retry_expires_at: null,
          updated_at: new Date().toISOString(),
        },
        { returning: false },
      ).catch(() => {});
    }

    const duplicates = await select(
      "media_objects",
      "select=*&owner_id=eq." + encodeURIComponent(user.id) +
        "&kind=eq." + encodeURIComponent(kind) +
        "&sha256=eq." + encodeURIComponent(received.sha256) +
        "&status=eq.ready&limit=1",
    ).catch(() => []);

    if (duplicates?.[0]) {
      if (job?.id) {
        await update(
          "upload_jobs",
          "id=eq." + encodeURIComponent(job.id),
          {
            media_id: duplicates[0].id,
            status: "completed",
            completed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          { returning: false },
        ).catch(() => {});
      }
      return json(res, 200, { ...duplicates[0], duplicate: true, upload_job_id: job?.id || null });
    }

    telegramUpload = await uploadToChannel({
      channelId: channel.channel_id,
      filePath: received.filePath,
      caption: "آشور · " + kind + " · " + user.id,
    });

    const rows = await insert("media_objects", {
      owner_id: user.id,
      kind,
      channel_key: channelKey,
      telegram_message_id: telegramUpload.messageId,
      telegram_file_id: telegramUpload.storageRef,
      original_name: originalName.slice(0, 250),
      mime_type: verifiedMimeType.slice(0, 150),
      size_bytes: received.size,
      sha256: received.sha256,
      status: "ready",
    });
    const media = rows?.[0] || {};
    mediaCreated = Boolean(media.id);

    await update(
      "storage_channels",
      "channel_key=eq." + encodeURIComponent(channelKey),
      { last_upload_at: new Date().toISOString() },
      { returning: false },
    ).catch(() => {});

    if (job?.id) {
      await update(
        "upload_jobs",
        "id=eq." + encodeURIComponent(job.id),
        {
          media_id: media.id || null,
          status: "completed",
          error: null,
          failure_stage: "",
          retry_available: false,
          retry_expires_at: null,
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { returning: false },
      ).catch(() => {});
    }

    json(res, 201, { ...media, upload_job_id: job?.id || null });
  } catch (error) {
    let retryAvailable = false;
    let retryExpiresAt = null;

    if (telegramUpload && !mediaCreated) {
      await deleteChannelMessage({ channelId: channel.channel_id, messageId: telegramUpload.messageId }).catch(() => {});
    }

    if (
      job?.id &&
      received?.filePath &&
      uploadStage === "storing" &&
      error.statusCode !== 499
    ) {
      try {
        const retryPath = retryUploadCachePath(job.id);
        await fsp.rm(retryPath, { force: true }).catch(() => {});
        await fsp.rename(received.filePath, retryPath);
        keepRetryFile = true;
        retryAvailable = true;
        retryExpiresAt = uploadRetryExpiry();
      } catch {}
    }

    if (job?.id) {
      await update(
        "upload_jobs",
        "id=eq." + encodeURIComponent(job.id),
        {
          status: error.statusCode === 499 ? "cancelled" : "failed",
          error: String(error.message || error).slice(0, 1000),
          failure_stage: uploadStage,
          retry_available: retryAvailable,
          retry_expires_at: retryExpiresAt,
          updated_at: new Date().toISOString(),
        },
        { returning: false },
      ).catch(() => {});
    }
    if (error.statusCode !== 499) {
      await logSystemError("upload", error, { kind, client_upload_id: clientUploadId, stage: uploadStage }, user.id);
    }
    throw error;
  } finally {
    if (received?.filePath && !keepRetryFile) {
      await fsp.rm(received.filePath, { force: true }).catch(() => {});
    }
  }
}

async function cancelUploadJob(req, res, uploadId) {
  const user = await currentUser(req);
  const rows = await select(
    "upload_jobs",
    "select=id,status&client_upload_id=eq." + encodeURIComponent(uploadId) + "&user_id=eq." + encodeURIComponent(user.id) + "&limit=1",
  );
  const job = rows?.[0];
  if (!job) return json(res, 404, { error: "عملية الرفع غير موجودة" });
  if (job.status === "completed") return json(res, 409, { error: "اكتمل الرفع بالفعل" });
  await update(
    "upload_jobs",
    "id=eq." + encodeURIComponent(job.id),
    { cancel_requested: true, updated_at: new Date().toISOString() },
    { returning: false },
  );
  return json(res, 200, { ok: true });
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
  const conversations = await select(
    "conversations",
    `select=id,kind,title,image_media_id,updated_at&id=in.(${ids.join(",")})&is_deleted=eq.false&order=updated_at.desc`,
  );

  const items = [];
  for (const conversation of conversations || []) {
    const messages = await select(
      "messages",
      `select=id,sender_id,body,media_id,shared_type,shared_id,created_at&conversation_id=eq.${encodeURIComponent(conversation.id)}&is_deleted=eq.false&order=created_at.desc&limit=100`,
    );
    const latest = messages?.[0] || null;
    const incomingIds = (messages || []).filter((m) => m.sender_id !== user.id).map((m) => m.id);
    let unreadCount = 0;
    if (incomingIds.length) {
      const reads = await select(
        "message_reads",
        `select=message_id&user_id=eq.${encodeURIComponent(user.id)}&message_id=in.(${incomingIds.join(",")})`,
      ).catch(() => []);
      const readSet = new Set((reads || []).map((r) => r.message_id));
      unreadCount = incomingIds.filter((id) => !readSet.has(id)).length;
    }

    let title = conversation.title || "";
    let peerProfile = null;
    if (conversation.kind === "direct") {
      const members = await select(
        "conversation_members",
        `select=user_id&conversation_id=eq.${encodeURIComponent(conversation.id)}&user_id=neq.${encodeURIComponent(user.id)}&limit=1`,
      );
      if (members?.[0]) {
        const profiles = await select(
          "profiles",
          `select=id,name,username,avatar_media_id,is_verified&id=eq.${encodeURIComponent(members[0].user_id)}&limit=1`,
        );
        peerProfile = profiles?.[0] || null;
        if (!title) title = peerProfile?.name || peerProfile?.username || "محادثة";
      }
    }

    const sharedLabel = latest?.shared_type === "post"
      ? "شارك منشورًا"
      : latest?.shared_type === "reel"
        ? "شارك ريلز"
        : latest?.shared_type === "story"
          ? "شارك قصة"
          : "";
    const lastMessage = latest?.body || sharedLabel || (latest?.media_id ? "مرفق" : "");

    items.push({
      ...conversation,
      title: title || "محادثة",
      peer_profile: peerProfile,
      last_message: lastMessage,
      unread_count: unreadCount,
      updated_at: latest?.created_at || conversation.updated_at,
    });
  }
  items.sort((a,b)=>new Date(b.updated_at)-new Date(a.updated_at));
  json(res, 200, { items });
}

async function conversationDetails(req, res, conversationId) {
  const user = await currentUser(req);
  const memberships = await select(
    "conversation_members",
    "select=user_id,role,nickname,muted,joined_at&conversation_id=eq." + encodeURIComponent(conversationId) +
      "&user_id=eq." + encodeURIComponent(user.id) + "&limit=1",
  );
  const ownMembership = memberships?.[0];
  if (!ownMembership) return json(res, 403, { error: "لست عضوًا في هذه المحادثة" });

  const rows = await select(
    "conversations",
    "select=id,kind,title,image_media_id,created_by,created_at,updated_at,is_deleted&id=eq." +
      encodeURIComponent(conversationId) + "&is_deleted=eq.false&limit=1",
  );
  const conversation = rows?.[0];
  if (!conversation) return json(res, 404, { error: "المحادثة غير موجودة" });

  const members = await select(
    "conversation_members",
    "select=user_id,role,nickname,muted,joined_at&conversation_id=eq." + encodeURIComponent(conversationId) +
      "&order=joined_at.asc&limit=250",
  );
  const ids = [...new Set((members || []).map((member) => member.user_id).filter(Boolean))];
  const profiles = ids.length
    ? await select(
        "profiles",
        "select=id,name,username,avatar_media_id,is_verified,is_private&id=in.(" + ids.map(encodeURIComponent).join(",") + ")",
      )
    : [];
  const profileMap = new Map((profiles || []).map((profile) => [profile.id, profile]));
  const enrichedMembers = (members || []).map((member) => ({
    ...member,
    profile: profileMap.get(member.user_id) || null,
  }));

  const peer = conversation.kind === "direct"
    ? enrichedMembers.find((member) => member.user_id !== user.id)?.profile || null
    : null;

  json(res, 200, {
    ...conversation,
    muted: Boolean(ownMembership.muted),
    my_role: ownMembership.role,
    member_count: enrichedMembers.length,
    peer_profile: peer,
    members: enrichedMembers,
  });
}

async function updateConversationSettings(req, res, conversationId) {
  const user = await currentUser(req);
  const memberships = await select(
    "conversation_members",
    "select=user_id,role,muted&conversation_id=eq." + encodeURIComponent(conversationId) +
      "&user_id=eq." + encodeURIComponent(user.id) + "&limit=1",
  );
  const ownMembership = memberships?.[0];
  if (!ownMembership) return json(res, 403, { error: "لست عضوًا في هذه المحادثة" });

  const conversations = await select(
    "conversations",
    "select=id,kind,title,image_media_id,created_by,is_deleted&id=eq." + encodeURIComponent(conversationId) +
      "&is_deleted=eq.false&limit=1",
  );
  const conversation = conversations?.[0];
  if (!conversation) return json(res, 404, { error: "المحادثة غير موجودة" });

  const body = await readJson(req);
  const response = { ok: true };

  if (typeof body.muted === "boolean") {
    await update(
      "conversation_members",
      "conversation_id=eq." + encodeURIComponent(conversationId) +
        "&user_id=eq." + encodeURIComponent(user.id),
      { muted: body.muted },
      { returning: false },
    );
    response.muted = body.muted;
  }

  if (body.title !== undefined) {
    if (conversation.kind !== "group") return json(res, 400, { error: "لا يمكن تغيير اسم المحادثة الخاصة" });
    if (!["owner","admin"].includes(String(ownMembership.role || ""))) {
      return json(res, 403, { error: "لا تملك صلاحية تعديل اسم المجموعة" });
    }
    const title = String(body.title || "").trim().slice(0, 80);
    if (title.length < 2) return json(res, 400, { error: "اسم المجموعة قصير جدًا" });
    await update(
      "conversations",
      "id=eq." + encodeURIComponent(conversationId),
      { title, updated_at: new Date().toISOString() },
      { returning: false },
    );
    response.title = title;
  }

  if (body.image_media_id !== undefined) {
    if (conversation.kind !== "group") return json(res, 400, { error: "صورة المجموعة متاحة للمجموعات فقط" });
    if (!["owner","admin"].includes(String(ownMembership.role || ""))) {
      return json(res, 403, { error: "لا تملك صلاحية تعديل صورة المجموعة" });
    }
    let imageMediaId = null;
    if (body.image_media_id) {
      const candidate = String(body.image_media_id);
      if (!/^[0-9a-f-]{36}$/i.test(candidate)) {
        return json(res, 400, { error: "معرّف صورة المجموعة غير صالح" });
      }
      const mediaRows = await select(
        "media_objects",
        "select=id,owner_id,kind,status&id=eq." + encodeURIComponent(candidate) +
          "&owner_id=eq." + encodeURIComponent(user.id) +
          "&kind=eq.group_media&status=eq.ready&limit=1",
      );
      if (!mediaRows?.[0]) return json(res, 400, { error: "صورة المجموعة غير متاحة" });
      imageMediaId = candidate;
    }
    await update(
      "conversations",
      "id=eq." + encodeURIComponent(conversationId),
      { image_media_id: imageMediaId, updated_at: new Date().toISOString() },
      { returning: false },
    );
    response.image_media_id = imageMediaId;
  }

  json(res, 200, response);
}


async function conversationManagementContext(user, conversationId) {
  const memberships = await select(
    "conversation_members",
    "select=user_id,role,nickname&conversation_id=eq." + encodeURIComponent(conversationId) +
      "&user_id=eq." + encodeURIComponent(user.id) + "&limit=1",
  );
  const membership = memberships?.[0];
  if (!membership) {
    const error = new Error("لست عضوًا في هذه المحادثة");
    error.statusCode = 403;
    throw error;
  }
  const conversations = await select(
    "conversations",
    "select=id,kind,title,image_media_id,created_by,is_deleted&id=eq." + encodeURIComponent(conversationId) +
      "&is_deleted=eq.false&limit=1",
  );
  const conversation = conversations?.[0];
  if (!conversation) {
    const error = new Error("المحادثة غير موجودة");
    error.statusCode = 404;
    throw error;
  }
  if (conversation.kind !== "group") {
    const error = new Error("إدارة الأعضاء متاحة للمجموعات فقط");
    error.statusCode = 400;
    throw error;
  }
  return { membership, conversation };
}

async function addConversationMember(req, res, conversationId) {
  const user = await currentUser(req);
  const { membership } = await conversationManagementContext(user, conversationId);
  if (!["owner","admin"].includes(String(membership.role || ""))) {
    return json(res, 403, { error: "لا تملك صلاحية إضافة أعضاء" });
  }

  const body = await readJson(req);
  const userId = String(body.user_id || "");
  if (!/^[0-9a-f-]{36}$/i.test(userId)) return json(res, 400, { error: "المستخدم غير صالح" });

  const existing = await select(
    "conversation_members",
    "select=user_id&conversation_id=eq." + encodeURIComponent(conversationId) +
      "&user_id=eq." + encodeURIComponent(userId) + "&limit=1",
  );
  if (existing?.[0]) return json(res, 200, { ok: true, already_member: true });

  const profiles = await select(
    "profiles",
    "select=id,is_banned&id=eq." + encodeURIComponent(userId) + "&limit=1",
  );
  if (!profiles?.[0] || profiles[0].is_banned) return json(res, 404, { error: "الحساب غير متاح" });
  if (await isBlockedBetween(user.id, userId)) {
    return json(res, 403, { error: "لا يمكن إضافة هذا الحساب إلى المجموعة" });
  }

  await insert("conversation_members", {
    conversation_id: conversationId,
    user_id: userId,
    role: "member",
    nickname: null,
  }, { returning: false });
  await update(
    "conversations",
    "id=eq." + encodeURIComponent(conversationId),
    { updated_at: new Date().toISOString() },
    { returning: false },
  );
  await writeAudit(user.id, "group_member_add", "conversation", conversationId, { user_id: userId });
  return json(res, 201, { ok: true, user_id: userId, role: "member" });
}

async function updateConversationMember(req, res, conversationId, targetUserId) {
  const user = await currentUser(req);
  const { membership } = await conversationManagementContext(user, conversationId);
  if (!["owner","admin"].includes(String(membership.role || ""))) {
    return json(res, 403, { error: "لا تملك صلاحية إدارة الأعضاء" });
  }

  const targetRows = await select(
    "conversation_members",
    "select=user_id,role,nickname&conversation_id=eq." + encodeURIComponent(conversationId) +
      "&user_id=eq." + encodeURIComponent(targetUserId) + "&limit=1",
  );
  const target = targetRows?.[0];
  if (!target) return json(res, 404, { error: "العضو غير موجود في المجموعة" });

  const body = await readJson(req);
  const patch = {};

  if (body.role !== undefined) {
    if (String(membership.role) !== "owner") {
      return json(res, 403, { error: "المالك فقط يستطيع تعيين المشرفين" });
    }
    if (String(target.role) === "owner" || targetUserId === user.id) {
      return json(res, 400, { error: "لا يمكن تغيير صلاحية مالك المجموعة" });
    }
    const nextRole = body.role === "admin" ? "admin" : body.role === "member" ? "member" : "";
    if (!nextRole) return json(res, 400, { error: "الصلاحية غير صالحة" });
    patch.role = nextRole;
  }

  if (body.nickname !== undefined) {
    const nickname = String(body.nickname || "").trim().slice(0, 32);
    patch.nickname = nickname || null;
  }

  if (!Object.keys(patch).length) return json(res, 400, { error: "لا توجد تعديلات" });

  await update(
    "conversation_members",
    "conversation_id=eq." + encodeURIComponent(conversationId) +
      "&user_id=eq." + encodeURIComponent(targetUserId),
    patch,
    { returning: false },
  );
  await writeAudit(user.id, "group_member_update", "conversation", conversationId, {
    user_id: targetUserId,
    role: patch.role,
    nickname: patch.nickname,
  });
  return json(res, 200, { ok: true, user_id: targetUserId, ...patch });
}

async function removeConversationMember(req, res, conversationId, targetUserId) {
  const user = await currentUser(req);
  const { membership } = await conversationManagementContext(user, conversationId);

  const targetRows = await select(
    "conversation_members",
    "select=user_id,role&conversation_id=eq." + encodeURIComponent(conversationId) +
      "&user_id=eq." + encodeURIComponent(targetUserId) + "&limit=1",
  );
  const target = targetRows?.[0];
  if (!target) return json(res, 404, { error: "العضو غير موجود في المجموعة" });

  const selfLeave = targetUserId === user.id;
  if (selfLeave) {
    if (String(target.role) === "owner") return json(res, 400, { error: "يجب نقل ملكية المجموعة قبل المغادرة" });
  } else {
    if (!["owner","admin"].includes(String(membership.role || ""))) {
      return json(res, 403, { error: "لا تملك صلاحية إزالة أعضاء" });
    }
    if (String(target.role) === "owner") return json(res, 400, { error: "لا يمكن إزالة مالك المجموعة" });
    if (String(membership.role) === "admin" && String(target.role) === "admin") {
      return json(res, 403, { error: "المشرف لا يستطيع إزالة مشرف آخر" });
    }
  }

  await remove(
    "conversation_members",
    "conversation_id=eq." + encodeURIComponent(conversationId) +
      "&user_id=eq." + encodeURIComponent(targetUserId),
    { returning: false },
  );
  await update(
    "conversations",
    "id=eq." + encodeURIComponent(conversationId),
    { updated_at: new Date().toISOString() },
    { returning: false },
  );
  await writeAudit(user.id, selfLeave ? "group_leave" : "group_member_remove", "conversation", conversationId, {
    user_id: targetUserId,
  });
  return json(res, 200, { ok: true, user_id: targetUserId });
}


async function createConversation(req, res) {
  const user = await currentUser(req);
  await requireFeature("messages", "الرسائل");
  const body = await readJson(req);
  const kind = body.kind === "group" ? "group" : "direct";
  if (kind === "group") await requireFeature("groups", "المجموعات");
  const requested = Array.isArray(body.member_ids)
    ? body.member_ids
    : body.target_user_id
      ? [body.target_user_id]
      : [];
  const memberIds = [...new Set([user.id, ...requested.filter((id) => /^[0-9a-f-]{36}$/i.test(String(id)))])];

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

  let directKey = null;
  if (kind === "direct") {
    const targetUserId = memberIds.find((id) => id !== user.id);
    if (await isBlockedBetween(user.id, targetUserId)) {
      const error = new Error("لا يمكن بدء محادثة مع هذا الحساب");
      error.statusCode = 403;
      throw error;
    }

    directKey = memberIds.map(String).sort().join(":");
    const existing = await select(
      "conversations",
      "select=id,kind,title,image_media_id,updated_at,direct_key&direct_key=eq." + encodeURIComponent(directKey) + "&is_deleted=eq.false&limit=1",
    ).catch(() => []);
    if (existing?.[0]) return json(res, 200, existing[0]);
  }

  let conversation;
  try {
    const created = await insert("conversations", {
      kind,
      title: kind === "group" ? String(body.title || "مجموعة").slice(0, 80) : "",
      created_by: user.id,
      direct_key: directKey,
      is_deleted: false,
    });
    conversation = created?.[0];
  } catch (error) {
    if (directKey) {
      const existing = await select(
        "conversations",
        "select=id,kind,title,image_media_id,updated_at,direct_key&direct_key=eq." + encodeURIComponent(directKey) + "&is_deleted=eq.false&limit=1",
      ).catch(() => []);
      if (existing?.[0]) return json(res, 200, existing[0]);
    }
    throw error;
  }

  const members = memberIds.map((id) => ({
    conversation_id: conversation.id,
    user_id: id,
    role: id === user.id ? "owner" : "member",
  }));
  await insert("conversation_members", members, { returning: false });
  json(res, 201, conversation);
}


async function listConversationMessages(req, res, conversationId) {
  const user = await currentUser(req);
  const membership = await select(
    "conversation_members",
    "select=user_id&conversation_id=eq." + encodeURIComponent(conversationId) + "&user_id=eq." + encodeURIComponent(user.id) + "&limit=1",
  );
  if (!membership?.length) return json(res, 403, { error: "لست عضوًا في هذه المحادثة" });

  const conversations = await select(
    "conversations",
    "select=id,kind&is_deleted=eq.false&id=eq." + encodeURIComponent(conversationId) + "&limit=1",
  );
  const conversation = conversations?.[0];
  if (!conversation) return json(res, 404, { error: "المحادثة غير موجودة" });

  const items = await select(
    "messages",
    "select=id,conversation_id,sender_id,body,media_id,reply_to,shared_type,shared_id,client_message_id,created_at&conversation_id=eq." +
      encodeURIComponent(conversationId) +
      "&is_deleted=eq.false&order=created_at.asc&limit=220",
  );

  const ownIds = (items || []).filter((m) => m.sender_id === user.id).map((m) => m.id);
  let readIds = new Set();
  if (ownIds.length) {
    const reads = await select(
      "message_reads",
      "select=message_id,user_id&message_id=in.(" + ownIds.join(",") + ")&user_id=neq." + encodeURIComponent(user.id),
    ).catch(() => []);
    readIds = new Set((reads || []).map((row) => row.message_id));
  }

  const senderIds = [...new Set((items || []).map((message) => message.sender_id).filter(Boolean))];
  const senderProfiles = senderIds.length
    ? await select(
        "profiles",
        "select=id,name,username,avatar_media_id,is_verified&id=in.(" + senderIds.map(encodeURIComponent).join(",") + ")",
      )
    : [];
  const senderProfileMap = new Map((senderProfiles || []).map((profile) => [profile.id, profile]));

  let memberMetaMap = new Map();
  if (conversation.kind === "group" && senderIds.length) {
    const memberRows = await select(
      "conversation_members",
      "select=user_id,role,nickname&conversation_id=eq." + encodeURIComponent(conversationId) +
        "&user_id=in.(" + senderIds.map(encodeURIComponent).join(",") + ")",
    ).catch(() => []);
    memberMetaMap = new Map((memberRows || []).map((member) => [member.user_id, member]));
  }

  json(res, 200, {
    items: (items || []).map((message) => {
      const memberMeta = memberMetaMap.get(message.sender_id) || {};
      return {
        ...message,
        read_by_other: readIds.has(message.id),
        sender_profile: senderProfileMap.get(message.sender_id) || null,
        sender_role: memberMeta.role || null,
        sender_nickname: memberMeta.nickname || null,
      };
    }),
  });
}


async function validateSharedMessageTarget(user, type, id) {
  if (!type || !id) return true;

  if (type === "profile") {
    const profile = await profileFor(id);
    return Boolean(profile && !profileIsBanned(profile) && await canViewOwner(user, id));
  }

  if (type === "post") {
    const rows = await select(
      "posts",
      "select=author_id,visibility,moderation_status,deleted_at&id=eq." + encodeURIComponent(id) + "&limit=1",
    );
    const row = rows?.[0];
    return Boolean(
      row &&
      !row.deleted_at &&
      row.moderation_status === "active" &&
      await canViewContentOwner(user, row.author_id, row.visibility || "public")
    );
  }

  if (type === "reel") {
    const rows = await select(
      "reels",
      "select=author_id,visibility,moderation_status,deleted_at&id=eq." + encodeURIComponent(id) + "&limit=1",
    );
    const row = rows?.[0];
    return Boolean(
      row &&
      !row.deleted_at &&
      row.moderation_status === "active" &&
      await canViewContentOwner(user, row.author_id, row.visibility || "public")
    );
  }

  if (type === "story") {
    const rows = await select(
      "stories",
      "select=author_id,expires_at,moderation_status,deleted_at&id=eq." + encodeURIComponent(id) + "&limit=1",
    );
    const row = rows?.[0];
    return Boolean(
      row &&
      !row.deleted_at &&
      row.moderation_status === "active" &&
      new Date(row.expires_at) > new Date() &&
      await canViewOwner(user, row.author_id)
    );
  }

  return false;
}


async function sendConversationMessage(req, res, conversationId) {
  const user = await currentUser(req);
  await requireFeature("messages", "الرسائل");
  const memberships = await select(
    "conversation_members",
    "select=user_id&conversation_id=eq." + encodeURIComponent(conversationId) + "&user_id=eq." + encodeURIComponent(user.id) + "&limit=1",
  );
  if (!memberships?.length) return json(res, 403, { error: "لست عضوًا في هذه المحادثة" });

  const conversations = await select(
    "conversations",
    "select=id,kind&is_deleted=eq.false&id=eq." + encodeURIComponent(conversationId) + "&limit=1",
  );
  const conversation = conversations?.[0];
  if (!conversation) return json(res, 404, { error: "المحادثة غير موجودة" });

  if (conversation.kind === "direct") {
    const peers = await select(
      "conversation_members",
      "select=user_id&conversation_id=eq." + encodeURIComponent(conversationId) + "&user_id=neq." + encodeURIComponent(user.id) + "&limit=1",
    );
    const peerId = peers?.[0]?.user_id;
    if (peerId && await isBlockedBetween(user.id, peerId)) {
      return json(res, 403, { error: "لا يمكن إرسال رسائل إلى هذا الحساب" });
    }
  }

  const body = await readJson(req);
  const text = String(body.body || "").trim().slice(0, 4000);
  const mediaId = /^[0-9a-f-]{36}$/i.test(String(body.media_id || "")) ? String(body.media_id) : null;
  const replyTo = /^[0-9a-f-]{36}$/i.test(String(body.reply_to || "")) ? String(body.reply_to) : null;
  const sharedType = ["post","reel","story","profile"].includes(body.shared_type) ? body.shared_type : null;
  const sharedId = /^[0-9a-f-]{36}$/i.test(String(body.shared_id || "")) ? String(body.shared_id) : null;
  const clientMessageId = /^[0-9a-f-]{36}$/i.test(String(body.client_message_id || ""))
    ? String(body.client_message_id)
    : null;

  if (!text && !mediaId && !(sharedType && sharedId)) {
    return json(res, 400, { error: "الرسالة فارغة" });
  }

  if (clientMessageId) {
    const existing = await select(
      "messages",
      "select=*&sender_id=eq." + encodeURIComponent(user.id) +
        "&client_message_id=eq." + encodeURIComponent(clientMessageId) + "&limit=1",
    ).catch(() => []);
    if (existing?.[0]) return json(res, 200, { ...existing[0], duplicate: true });
  }

  if (replyTo) {
    const parent = await select(
      "messages",
      "select=id&conversation_id=eq." + encodeURIComponent(conversationId) +
        "&id=eq." + encodeURIComponent(replyTo) + "&is_deleted=eq.false&limit=1",
    );
    if (!parent?.[0]) return json(res, 400, { error: "الرسالة التي ترد عليها غير متاحة في هذه المحادثة" });
  }

  if (mediaId) {
    const owned = await select(
      "media_objects",
      "select=id,kind,status&owner_id=eq." + encodeURIComponent(user.id) +
        "&id=eq." + encodeURIComponent(mediaId) + "&status=eq.ready&limit=1",
    );
    const media = owned?.[0];
    const allowedKinds = conversation.kind === "group"
      ? ["chat_image","chat_video","chat_audio","chat_file","group_media"]
      : ["chat_image","chat_video","chat_audio","chat_file"];
    if (!media || !allowedKinds.includes(media.kind)) {
      return json(res, 403, { error: "المرفق غير صالح لهذه المحادثة" });
    }
  }

  if ((sharedType && !sharedId) || (!sharedType && sharedId)) {
    return json(res, 400, { error: "بيانات المشاركة غير مكتملة" });
  }
  if (sharedType && !(await validateSharedMessageTarget(user, sharedType, sharedId))) {
    return json(res, 403, { error: "المحتوى المشارك غير متاح" });
  }

  let message;
  try {
    const rows = await insert("messages", {
      conversation_id: conversationId,
      sender_id: user.id,
      body: text,
      media_id: mediaId,
      reply_to: replyTo,
      shared_type: sharedType,
      shared_id: sharedType ? sharedId : null,
      client_message_id: clientMessageId,
    });
    message = rows?.[0];
  } catch (error) {
    if (clientMessageId) {
      const existing = await select(
        "messages",
        "select=*&sender_id=eq." + encodeURIComponent(user.id) +
          "&client_message_id=eq." + encodeURIComponent(clientMessageId) + "&limit=1",
      ).catch(() => []);
      if (existing?.[0]) return json(res, 200, { ...existing[0], duplicate: true });
    }
    throw error;
  }

  await update("conversations", "id=eq." + encodeURIComponent(conversationId), {
    updated_at: new Date().toISOString(),
  }, { returning: false }).catch(() => {});

  const others = await select(
    "conversation_members",
    "select=user_id,muted&conversation_id=eq." + encodeURIComponent(conversationId) + "&user_id=neq." + encodeURIComponent(user.id),
  ).catch(() => []);
  const senderProfiles = await select(
    "profiles",
    "select=name,username&id=eq." + encodeURIComponent(user.id) + "&limit=1",
  ).catch(() => []);
  const sender = senderProfiles?.[0];
  const title = sender?.name || sender?.username || "رسالة جديدة";
  const preview = text || (sharedType
    ? (sharedType === "post" ? "شارك منشورًا" : sharedType === "reel" ? "شارك ريلز" : sharedType === "story" ? "شارك قصة" : "شارك حسابًا")
    : mediaId ? "أرسل مرفقًا" : "رسالة جديدة");

  for (const member of others || []) {
    await insert("notifications", {
      user_id: member.user_id,
      actor_id: user.id,
      kind: "message",
      title,
      body: preview.slice(0, 200),
      entity_type: "conversation",
      entity_id: conversationId,
    }, { returning: false }).catch(() => {});
  }

  const pushIds = (others || []).filter((m) => !m.muted).map((m) => m.user_id);
  if (pushIds.length) {
    await sendPush({
      userIds: pushIds,
      title,
      body: preview.slice(0, 180),
      data: { kind: "message", conversation_id: conversationId },
    }).catch(() => {});
  }

  json(res, 201, message || { ok: true });
}

async function socialShareToStory(req, res) {
  const user = await currentUser(req);
  const body = await readJson(req);
  const type = body.type === "reel" ? "reel" : body.type === "post" ? "post" : "";
  const id = String(body.id || "");
  if (!type || !/^[0-9a-f-]{36}$/i.test(id)) return json(res, 400, { error: "المحتوى غير صالح" });

  let source = null;
  let mediaId = null;
  if (type === "post") {
    const rows = await select("posts", "select=id,author_id,caption,visibility&id=eq." + encodeURIComponent(id) + "&limit=1");
    source = rows?.[0];
    const media = await select("post_media", "select=media_id&post_id=eq." + encodeURIComponent(id) + "&order=sort_order.asc&limit=1");
    mediaId = media?.[0]?.media_id || null;
  } else {
    const rows = await select("reels", "select=id,author_id,caption,visibility,media_id&id=eq." + encodeURIComponent(id) + "&limit=1");
    source = rows?.[0];
    mediaId = source?.media_id || null;
  }
  if (!source || !mediaId) return json(res, 404, { error: "تعذر العثور على وسائط المحتوى" });

  if (source.author_id !== user.id) {
    const owner = await profileFor(source.author_id);
    if (!owner || owner.is_private || source.visibility !== "public") {
      return json(res, 403, { error: "يمكن مشاركة المحتوى العام فقط داخل القصة" });
    }
    if (await isBlockedBetween(user.id, source.author_id)) {
      return json(res, 403, { error: "لا يمكنك مشاركة هذا المحتوى" });
    }
  }

  const rows = await insert("stories", {
    author_id: user.id,
    media_id: mediaId,
    caption: String(body.caption || "").slice(0, 300),
    shared_type: type,
    shared_id: id,
  });
  json(res, 201, rows?.[0] || { ok: true });
}

async function socialPublicSaved(req, res, profileId, url) {
  const user = await currentUser(req);
  const profile = await profileFor(profileId);
  if (!profile || profileIsBanned(profile)) return json(res, 404, { error: "الحساب غير موجود" });
  if (profileId !== user.id && profile.saved_visibility !== "public") {
    return json(res, 403, { error: "المحفوظات خاصة" });
  }
  if (profileId !== user.id && !(await canViewOwner(user, profileId))) {
    return json(res, 403, { error: "الحساب خاص" });
  }
  const kind = url.searchParams.get("kind") === "reels" ? "reels" : "posts";
  const table = kind === "reels" ? "saved_reels" : "saved_posts";
  const idField = kind === "reels" ? "reel_id" : "post_id";
  const rows = await select(
    table,
    "select=" + idField + ",created_at&user_id=eq." + encodeURIComponent(profileId) + "&order=created_at.desc&limit=100",
  );
  json(res, 200, { items: rows || [] });
}

async function ensureMentionDirectConversation(senderId, targetUserId) {
  const directKey = [senderId, targetUserId].map(String).sort().join(":");
  let conversations = await select(
    "conversations",
    "select=id&direct_key=eq." + encodeURIComponent(directKey) + "&is_deleted=eq.false&limit=1",
  ).catch(() => []);
  if (conversations?.[0]) return conversations[0].id;

  try {
    const created = await insert("conversations", {
      kind: "direct",
      title: "",
      created_by: senderId,
      direct_key: directKey,
      is_deleted: false,
    });
    const conversationId = created?.[0]?.id;
    if (!conversationId) throw new Error("تعذر إنشاء المحادثة");
    await insert("conversation_members", [
      { conversation_id: conversationId, user_id: senderId, role: "owner" },
      { conversation_id: conversationId, user_id: targetUserId, role: "member" },
    ], { returning: false });
    return conversationId;
  } catch (error) {
    conversations = await select(
      "conversations",
      "select=id&direct_key=eq." + encodeURIComponent(directKey) + "&is_deleted=eq.false&limit=1",
    ).catch(() => []);
    if (conversations?.[0]) return conversations[0].id;
    throw error;
  }
}

async function socialMentions(req, res) {
  const user = await currentUser(req);
  const body = await readJson(req);
  const caption = String(body.caption || "").slice(0, 4000);
  const type = ["post","reel","story","comment"].includes(body.type) ? body.type : "post";
  const id = String(body.id || "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json(res, 400, { error: "معرف المحتوى غير صالح" });

  const sourceTable = ({ post: "posts", reel: "reels", story: "stories", comment: "comments" })[type];
  const sourceRows = await select(
    sourceTable,
    "select=id,author_id&id=eq." + encodeURIComponent(id) + "&limit=1",
  ).catch(() => []);
  if (!sourceRows?.[0]) return json(res, 404, { error: "المحتوى غير موجود" });
  if (sourceRows[0].author_id !== user.id) {
    return json(res, 403, { error: "لا يمكنك إرسال إشارات من محتوى لا تملكه" });
  }

  const usernames = [...new Set(
    [...caption.matchAll(/@([A-Za-z0-9_.]{2,10})/g)].map((m) => m[1].toLowerCase())
  )].slice(0, 20);
  const hashtags = [...new Set(
    [...caption.matchAll(/#([\p{L}\p{N}_]{2,50})/gu)].map((m) => m[1].toLowerCase())
  )].slice(0, 30);

  if (!usernames.length) return json(res, 200, { ok: true, mentions: 0, hashtags, direct_messages: 0 });
  const profiles = await select(
    "profiles",
    "select=id,name,username&username=in.(" + usernames.map((x) => '"' + x.replace(/"/g, "") + '"').join(",") + ")&is_banned=eq.false",
  ).catch(() => []);
  const sender = await profileFor(user.id).catch(() => null);
  const label = type === "reel" ? "ريلز" : type === "story" ? "قصة" : type === "comment" ? "تعليق" : "منشور";
  let countNotified = 0;
  let directMessages = 0;

  for (const profile of profiles || []) {
    if (profile.id === user.id || await isBlockedBetween(user.id, profile.id)) continue;
    if (type === "story" && !(await isAcceptedFollower(profile.id, user.id))) continue;

    let firstMention = true;
    if (type === "story") {
      const existingStoryMention = await select(
        "story_mentions",
        "select=story_id&story_id=eq." + encodeURIComponent(id) +
          "&user_id=eq." + encodeURIComponent(profile.id) + "&limit=1",
      ).catch(() => []);
      firstMention = !existingStoryMention?.length;
      await upsert("story_mentions", {
        story_id: id,
        user_id: profile.id,
        mentioned_by: user.id,
        created_at: new Date().toISOString(),
      }, "story_id,user_id").catch(() => {});
    } else {
      const existingMention = await select(
        "content_mentions",
        "select=content_id&content_type=eq." + encodeURIComponent(type) +
          "&content_id=eq." + encodeURIComponent(id) +
          "&user_id=eq." + encodeURIComponent(profile.id) + "&limit=1",
      ).catch(() => []);
      firstMention = !existingMention?.length;
      if (firstMention) {
        try {
          await insert("content_mentions", {
            content_type: type,
            content_id: id,
            user_id: profile.id,
            mentioned_by: user.id,
          }, { returning: false });
        } catch {
          firstMention = false;
        }
      }
    }

    if (!firstMention) continue;

    const title = "تمت الإشارة إليك";
    const message = (sender?.name || sender?.username || "مستخدم") + " أشار إليك في " + label;
    await insert("notifications", {
      user_id: profile.id,
      actor_id: user.id,
      kind: "mention",
      title,
      body: message,
      entity_type: type,
      entity_id: id,
    }, { returning: false }).catch(() => {});
    await sendPush({
      userIds: [profile.id],
      title,
      body: message,
      data: { kind: "mention", entity_type: type, entity_id: id },
    }).catch(() => {});
    countNotified++;

    if (type === "post") {
      try {
        const conversationId = await ensureMentionDirectConversation(user.id, profile.id);
        await insert("messages", {
          conversation_id: conversationId,
          sender_id: user.id,
          body: "ذكرتك في هذا المنشور",
          shared_type: "post",
          shared_id: id,
          client_message_id: crypto.randomUUID(),
        }, { returning: false });
        await update("conversations", "id=eq." + encodeURIComponent(conversationId), {
          updated_at: new Date().toISOString(),
        }, { returning: false });
        directMessages++;
      } catch (error) {
        console.warn("ASHUR_MENTION_DM_FAILED", profile.id, error?.message || error);
      }
    }
  }
  json(res, 200, { ok: true, mentions: countNotified, hashtags, direct_messages: directMessages });
}

async function socialReshareMentionedStory(req, res) {
  const user = await currentUser(req);
  const body = await readJson(req);
  const storyId = String(body.story_id || "");
  if (!/^[0-9a-f-]{36}$/i.test(storyId)) return json(res, 400, { error: "معرف القصة غير صالح" });

  const stories = await select(
    "stories",
    "select=id,author_id,media_id,caption,expires_at,moderation_status,deleted_at&id=eq." + encodeURIComponent(storyId) + "&limit=1",
  );
  const source = stories?.[0];
  if (!source || source.deleted_at || source.moderation_status !== "active" || new Date(source.expires_at) <= new Date()) {
    return json(res, 404, { error: "القصة غير متاحة" });
  }

  const mentions = await select(
    "story_mentions",
    "select=story_id&story_id=eq." + encodeURIComponent(storyId) +
      "&user_id=eq." + encodeURIComponent(user.id) + "&limit=1",
  );
  if (!mentions?.length) return json(res, 403, { error: "يمكن إعادة مشاركة القصة فقط إذا تمت الإشارة إليك فيها" });
  if (await isBlockedBetween(user.id, source.author_id)) return json(res, 403, { error: "لا يمكن مشاركة هذه القصة" });

  const existing = await select(
    "stories",
    "select=id&author_id=eq." + encodeURIComponent(user.id) +
      "&reshared_from_story_id=eq." + encodeURIComponent(storyId) +
      "&expires_at=gt." + encodeURIComponent(new Date().toISOString()) + "&limit=1",
  ).catch(() => []);
  if (existing?.length) return json(res, 200, { ...existing[0], already_shared: true });

  const rows = await insert("stories", {
    author_id: user.id,
    media_id: source.media_id,
    caption: String(body.caption || "").trim().slice(0, 300),
    shared_type: "story",
    shared_id: source.id,
    reshared_from_story_id: source.id,
  });
  json(res, 201, rows?.[0] || { ok: true });
}

async function socialBlock(req, res, targetUserId) {
  const user = await currentUser(req);
  if (targetUserId === user.id) return json(res, 400, { error: "لا يمكنك حظر حسابك" });
  const target = await profileFor(targetUserId);
  if (!target) return json(res, 404, { error: "الحساب غير موجود" });
  const body = await readJson(req);
  const blocked = body.blocked !== false;

  if (blocked) {
    await upsert("blocks", {
      blocker_id: user.id,
      blocked_id: targetUserId,
      created_at: new Date().toISOString(),
    }, "blocker_id,blocked_id");
    await remove(
      "follows",
      "or=(and(follower_id.eq." + encodeURIComponent(user.id) + ",following_id.eq." + encodeURIComponent(targetUserId) + "),and(follower_id.eq." + encodeURIComponent(targetUserId) + ",following_id.eq." + encodeURIComponent(user.id) + "))",
    ).catch(() => {});
  } else {
    await remove(
      "blocks",
      "blocker_id=eq." + encodeURIComponent(user.id) + "&blocked_id=eq." + encodeURIComponent(targetUserId),
    );
  }
  json(res, 200, { ok: true, blocked });
}

async function socialBlockedList(req, res) {
  const user = await currentUser(req);
  const rows = await select(
    "blocks",
    "select=blocked_id,created_at&blocker_id=eq." + encodeURIComponent(user.id) + "&order=created_at.desc&limit=200",
  );
  const items = [];
  for (const row of rows || []) {
    const profiles = await select(
      "profiles",
      "select=id,name,username,avatar_media_id,is_verified&id=eq." + encodeURIComponent(row.blocked_id) + "&limit=1",
    );
    if (profiles?.[0]) items.push({ ...profiles[0], blocked_at: row.created_at });
  }
  json(res, 200, { items });
}

async function socialReport(req, res) {
  const user = await currentUser(req);
  const body = await readJson(req);
  const targetType = String(body.target_type || "").trim();
  const targetId = String(body.target_id || "").trim();
  const reason = String(body.reason || "").trim().slice(0, 120);
  const details = String(body.details || "").trim().slice(0, 1500);
  const allowed = ["profile", "post", "reel", "story", "comment", "message"];
  if (!allowed.includes(targetType) || !/^[0-9a-f-]{36}$/i.test(targetId) || !reason) {
    return json(res, 400, { error: "بيانات البلاغ غير مكتملة" });
  }
  const recent = await select(
    "reports",
    "select=id&reporter_id=eq." + encodeURIComponent(user.id) +
      "&target_type=eq." + encodeURIComponent(targetType) +
      "&target_id=eq." + encodeURIComponent(targetId) +
      "&status=in.(open,review)&limit=1",
  ).catch(() => []);
  if (recent?.length) return json(res, 409, { error: "سبق أن أرسلت بلاغًا عن هذا العنصر" });

  const rows = await insert("reports", {
    reporter_id: user.id,
    target_type: targetType,
    target_id: targetId,
    reason,
    details,
    status: "open",
  });
  json(res, 201, rows?.[0] || { ok: true });
}

async function supportEvent(ticketId, actorUserId, eventType, note = "", payload = {}) {
  return insert("support_events", {
    ticket_id: ticketId,
    actor_user_id: actorUserId || null,
    event_type: String(eventType || "update").slice(0, 80),
    note: String(note || "").slice(0, 1500),
    payload: payload && typeof payload === "object" ? payload : {},
  }, { returning: false }).catch(() => {});
}

async function socialSupport(req, res) {
  const user = await currentUser(req);
  const body = await readJson(req);
  const subject = String(body.subject || "").trim().slice(0, 160);
  const message = String(body.body || "").trim().slice(0, 4000);
  const category = ["technical","account","content","upload","other","general"].includes(String(body.category || ""))
    ? String(body.category)
    : "general";
  if (!subject || !message) return json(res, 400, { error: "اكتب عنوان المشكلة وتفاصيلها" });

  const now = new Date().toISOString();
  const rows = await insert("support_tickets", {
    user_id: user.id,
    category,
    subject,
    body: message,
    app_version: String(body.app_version || "").slice(0, 40),
    device_info: String(body.device_info || "").slice(0, 300),
    priority: "normal",
    status: "open",
    unread_by_admin: true,
    unread_by_user: false,
    last_message_at: now,
    last_user_reply_at: now,
  });
  const ticket = rows?.[0];
  if (ticket?.id) {
    await insert("support_messages", {
      ticket_id: ticket.id,
      sender_kind: "user",
      sender_user_id: user.id,
      body: message,
      created_at: now,
    }, { returning: false });
    await supportEvent(ticket.id, user.id, "ticket_created", "", { category });
  }
  json(res, 201, ticket || { ok: true });
}

async function socialSupportList(req, res) {
  const user = await currentUser(req);
  const rows = await select(
    "support_tickets",
    "select=id,category,subject,body,status,priority,admin_reply,unread_by_user,last_message_at,created_at,updated_at,closed_at&user_id=eq." +
      encodeURIComponent(user.id) + "&order=last_message_at.desc.nullslast,created_at.desc&limit=100",
  );
  json(res, 200, { items: rows || [] });
}

async function socialSupportDetail(req, res, ticketId) {
  const user = await currentUser(req);
  const rows = await select(
    "support_tickets",
    "select=id,user_id,category,subject,body,status,priority,admin_reply,app_version,device_info,unread_by_user,last_message_at,created_at,updated_at,closed_at&" +
      "id=eq." + encodeURIComponent(ticketId) + "&user_id=eq." + encodeURIComponent(user.id) + "&limit=1",
  );
  const ticket = rows?.[0];
  if (!ticket) return json(res, 404, { error: "تذكرة الدعم غير موجودة" });

  const messages = await select(
    "support_messages",
    "select=id,sender_kind,sender_user_id,body,created_at&ticket_id=eq." +
      encodeURIComponent(ticketId) + "&order=created_at.asc&limit=500",
  ).catch(() => []);

  if (ticket.unread_by_user) {
    await update("support_tickets", "id=eq." + encodeURIComponent(ticketId), {
      unread_by_user: false,
      updated_at: new Date().toISOString(),
    }, { returning: false }).catch(() => {});
  }

  json(res, 200, { ticket: { ...ticket, unread_by_user: false }, messages: messages || [] });
}

async function socialSupportReply(req, res, ticketId) {
  const user = await currentUser(req);
  const rows = await select(
    "support_tickets",
    "select=id,user_id,status,assigned_to&id=eq." + encodeURIComponent(ticketId) +
      "&user_id=eq." + encodeURIComponent(user.id) + "&limit=1",
  );
  const ticket = rows?.[0];
  if (!ticket) return json(res, 404, { error: "تذكرة الدعم غير موجودة" });
  if (ticket.status === "closed") return json(res, 409, { error: "هذه التذكرة مغلقة. أنشئ طلب دعم جديدًا إذا احتجت متابعة." });

  const body = await readJson(req);
  const message = String(body.body || "").trim().slice(0, 4000);
  if (!message) return json(res, 400, { error: "اكتب رسالتك للدعم" });

  const now = new Date().toISOString();
  const rowsMsg = await insert("support_messages", {
    ticket_id: ticketId,
    sender_kind: "user",
    sender_user_id: user.id,
    body: message,
    created_at: now,
  });

  await update("support_tickets", "id=eq." + encodeURIComponent(ticketId), {
    status: "open",
    unread_by_admin: true,
    unread_by_user: false,
    last_message_at: now,
    last_user_reply_at: now,
    updated_at: now,
    closed_at: null,
  }, { returning: false });
  await supportEvent(ticketId, user.id, "user_reply", "", {});
  json(res, 201, rowsMsg?.[0] || { ok: true });
}

async function socialSave(req, res) {
  const user = await currentUser(req);
  await requireFeature("saved", "المحفوظات");
  const body = await readJson(req);
  const kind = body.kind === "reel" ? "reel" : body.kind === "post" ? "post" : "";
  const id = String(body.id || "");
  if (!kind || !/^[0-9a-f-]{36}$/i.test(id)) return json(res, 400, { error: "المحتوى غير صالح" });
  const table = kind === "reel" ? "saved_reels" : "saved_posts";
  const idField = kind === "reel" ? "reel_id" : "post_id";
  if (body.saved === false) {
    await remove(table, "user_id=eq." + encodeURIComponent(user.id) + "&" + idField + "=eq." + encodeURIComponent(id));
    return json(res, 200, { ok: true, saved: false });
  }
  await upsert(table, { user_id: user.id, [idField]: id }, "user_id," + idField);
  json(res, 200, { ok: true, saved: true });
}

async function socialSaved(req, res, url) {
  const user = await currentUser(req);
  await requireFeature("saved", "المحفوظات");
  const kind = url.searchParams.get("kind") === "reels" ? "reels" : "posts";
  const table = kind === "reels" ? "saved_reels" : "saved_posts";
  const idField = kind === "reels" ? "reel_id" : "post_id";
  const rows = await select(
    table,
    "select=" + idField + ",created_at&user_id=eq." + encodeURIComponent(user.id) + "&order=created_at.desc&limit=100",
  );
  json(res, 200, { items: rows || [] });
}

async function socialStoryView(req, res, storyId) {
  const user = await currentUser(req);
  const stories = await select(
    "stories",
    "select=id,author_id,expires_at&id=eq." + encodeURIComponent(storyId) + "&limit=1",
  );
  const story = stories?.[0];
  if (!story || new Date(story.expires_at) <= new Date()) return json(res, 404, { error: "القصة غير موجودة" });
  if (story.author_id !== user.id && !(await isAcceptedFollower(user.id, story.author_id))) {
    return json(res, 403, { error: "هذه القصة متاحة للمتابعين المقبولين فقط" });
  }
  if (story.author_id !== user.id) {
    await upsert("story_views", {
      story_id: storyId,
      user_id: user.id,
      viewed_at: new Date().toISOString(),
    }, "story_id,user_id");
  }
  json(res, 200, { ok: true });
}

async function socialStoryViewers(req, res, storyId) {
  const user = await currentUser(req);
  const stories = await select(
    "stories",
    "select=id,author_id&id=eq." + encodeURIComponent(storyId) + "&limit=1",
  );
  if (!stories?.[0]) return json(res, 404, { error: "القصة غير موجودة" });
  if (stories[0].author_id !== user.id) return json(res, 403, { error: "هذه البيانات لصاحب القصة فقط" });

  const rows = await select(
    "story_views",
    "select=user_id,viewed_at&story_id=eq." + encodeURIComponent(storyId) + "&order=viewed_at.desc&limit=500",
  );
  const ids = [...new Set((rows || []).map((row) => row.user_id).filter(Boolean))];
  if (!ids.length) return json(res, 200, { items: [] });

  const profiles = await select(
    "profiles",
    "select=id,name,username,avatar_media_id,is_verified&id=in.(" + ids.map(encodeURIComponent).join(",") + ")",
  );
  const profileMap = new Map((profiles || []).map((profile) => [profile.id, profile]));
  const items = (rows || []).map((row) => {
    const profile = profileMap.get(row.user_id);
    return profile ? { ...profile, viewed_at: row.viewed_at } : null;
  }).filter(Boolean);

  json(res, 200, { items });
}

async function socialFollowList(req, res, profileId, url) {
  const user = await currentUser(req);
  const mode = url.searchParams.get("mode") === "following" ? "following" : "followers";
  if (await isBlockedBetween(user.id, profileId)) return json(res, 403, { error: "هذه القائمة غير متاحة" });
  const profile = await profileFor(profileId);
  if (!profile) return json(res, 404, { error: "الحساب غير موجود" });
  if (profile.is_private && profileId !== user.id && !(await canViewOwner(user, profileId))) {
    return json(res, 403, { error: "الحساب خاص" });
  }

  const filter = mode === "following"
    ? "follower_id=eq." + encodeURIComponent(profileId)
    : "following_id=eq." + encodeURIComponent(profileId);
  const idField = mode === "following" ? "following_id" : "follower_id";
  const rows = await select(
    "follows",
    "select=" + idField + ",created_at&" + filter + "&status=eq.accepted&order=created_at.desc&limit=500",
  );

  const visibleIds = [];
  for (const row of rows || []) {
    const id = row[idField];
    if (!id || await isBlockedBetween(user.id, id)) continue;
    visibleIds.push(id);
  }
  const ids = [...new Set(visibleIds)];
  if (!ids.length) return json(res, 200, { items: [] });

  const encodedIds = ids.map(encodeURIComponent).join(",");
  const [profiles, viewerFollowing, followsViewer] = await Promise.all([
    select(
      "profiles",
      "select=id,name,username,bio,avatar_media_id,is_verified,is_private&id=in.(" + encodedIds + ")&is_banned=eq.false",
    ),
    select(
      "follows",
      "select=following_id,status&follower_id=eq." + encodeURIComponent(user.id) +
        "&following_id=in.(" + encodedIds + ")",
    ).catch(() => []),
    select(
      "follows",
      "select=follower_id,status&following_id=eq." + encodeURIComponent(user.id) +
        "&follower_id=in.(" + encodedIds + ")",
    ).catch(() => []),
  ]);

  const profileMap = new Map((profiles || []).map((p) => [p.id, p]));
  const viewerMap = new Map((viewerFollowing || []).map((row) => [row.following_id, row.status]));
  const followsViewerSet = new Set(
    (followsViewer || []).filter((row) => row.status === "accepted").map((row) => row.follower_id),
  );

  const items = ids.map((id) => {
    const p = profileMap.get(id);
    if (!p) return null;
    return {
      ...p,
      viewer_status: viewerMap.get(id) || "",
      follows_viewer: followsViewerSet.has(id),
    };
  }).filter(Boolean);

  json(res, 200, { items });
}

async function socialMessageRead(req, res) {
  const user = await currentUser(req);
  const body = await readJson(req);
  const requested = Array.isArray(body.message_ids)
    ? [...new Set(body.message_ids.filter((x) => /^[0-9a-f-]{36}$/i.test(String(x))).map(String))].slice(0, 200)
    : [];
  if (!requested.length) return json(res, 200, { ok: true, count: 0 });

  const messages = await select(
    "messages",
    "select=id,conversation_id,sender_id&is_deleted=eq.false&id=in.(" + requested.join(",") + ")",
  );
  const conversationIds = [...new Set((messages || []).map((m) => m.conversation_id))];
  const memberships = conversationIds.length
    ? await select(
        "conversation_members",
        "select=conversation_id&user_id=eq." + encodeURIComponent(user.id) +
          "&conversation_id=in.(" + conversationIds.join(",") + ")",
      )
    : [];
  const allowedConversations = new Set((memberships || []).map((row) => row.conversation_id));
  const allowedIds = (messages || [])
    .filter((m) => m.sender_id !== user.id && allowedConversations.has(m.conversation_id))
    .map((m) => m.id);

  if (!allowedIds.length) return json(res, 200, { ok: true, count: 0 });

  const rows = allowedIds.map((messageId) => ({
    message_id: messageId,
    user_id: user.id,
    read_at: new Date().toISOString(),
  }));
  await upsert("message_reads", rows, "message_id,user_id");
  json(res, 200, { ok: true, count: rows.length });
}

async function socialEditContent(req, res, kind, id) {
  const user = await currentUser(req);
  const table = ({ posts: "posts", reels: "reels", stories: "stories" })[kind];
  if (!table) return json(res, 400, { error: "نوع المحتوى غير صالح" });
  const selectFields = table === "posts" ? "id,author_id,pinned_at" : "id,author_id";
  const rows = await select(table, "select=" + selectFields + "&id=eq." + encodeURIComponent(id) + "&limit=1");
  if (!rows?.[0]) return json(res, 404, { error: "المحتوى غير موجود" });
  if (rows[0].author_id !== user.id) return json(res, 403, { error: "لا يمكنك تعديل هذا المحتوى" });

  const body = await readJson(req);
  const patch = {};
  if (body.caption !== undefined) patch.caption = String(body.caption || "").slice(0, 2200);
  if (body.comments_enabled !== undefined && table !== "stories") patch.comments_enabled = Boolean(body.comments_enabled);
  if (body.visibility !== undefined && table !== "stories") {
    patch.visibility = ["public", "followers"].includes(body.visibility) ? body.visibility : "public";
  }

  if (table === "posts" && body.pinned !== undefined) {
    const pinned = Boolean(body.pinned);
    if (pinned && !rows[0].pinned_at) {
      const existingPinned = await count(
        "posts",
        "author_id=eq." + encodeURIComponent(user.id) +
          "&pinned_at=not.is.null&deleted_at=is.null&moderation_status=eq.active",
      );
      if (existingPinned >= 3) {
        return json(res, 409, { error: "يمكن تثبيت 3 منشورات كحد أقصى. ألغِ تثبيت منشور أولًا." });
      }
    }
    patch.pinned_at = pinned ? (rows[0].pinned_at || new Date().toISOString()) : null;
  }

  if (table === "posts") patch.updated_at = new Date().toISOString();
  if (!Object.keys(patch).length) return json(res, 400, { error: "لا توجد تعديلات" });
  const updated = await update(table, "id=eq." + encodeURIComponent(id), patch);
  json(res, 200, updated?.[0] || { ok: true });
}

async function socialDeleteContent(req, res, kind, id) {
  const user = await currentUser(req);
  const table = ({ posts: "posts", reels: "reels", stories: "stories" })[kind];
  if (!table) return json(res, 400, { error: "نوع المحتوى غير صالح" });

  const fields = table === "posts"
    ? "id,author_id"
    : table === "reels"
      ? "id,author_id,media_id,cover_media_id"
      : "id,author_id,media_id";
  const rows = await select(table, "select=" + fields + "&id=eq." + encodeURIComponent(id) + "&limit=1");
  if (!rows?.[0]) return json(res, 404, { error: "المحتوى غير موجود" });
  if (rows[0].author_id !== user.id) return json(res, 403, { error: "لا يمكنك حذف هذا المحتوى" });

  let mediaIds = [];
  if (kind === "posts") {
    const media = await select("post_media", "select=media_id&post_id=eq." + encodeURIComponent(id)).catch(() => []);
    mediaIds = (media || []).map((item) => item.media_id);
  } else {
    if (rows[0].media_id) mediaIds.push(rows[0].media_id);
    if (rows[0].cover_media_id && rows[0].cover_media_id !== rows[0].media_id) mediaIds.push(rows[0].cover_media_id);
  }
  mediaIds = [...new Set(mediaIds.filter(Boolean))];
  await remove(table, "id=eq." + encodeURIComponent(id));
  const cleanup = [];
  for (const mediaId of mediaIds) {
    cleanup.push(await purgeMediaObject(mediaId, user.id).catch((error) => ({
      media_id: mediaId,
      status: "cleanup_pending",
      error: String(error.message || error),
    })));
  }
  json(res, 200, { ok: true, media_count: mediaIds.length, cleanup });
}

async function socialEditComment(req, res, commentId) {
  const user = await currentUser(req);
  const rows = await select("comments", "select=id,author_id&id=eq." + encodeURIComponent(commentId) + "&limit=1");
  if (!rows?.[0]) return json(res, 404, { error: "التعليق غير موجود" });
  if (rows[0].author_id !== user.id) return json(res, 403, { error: "لا يمكنك تعديل هذا التعليق" });
  if (req.method === "DELETE") {
    await remove("comments", "id=eq." + encodeURIComponent(commentId));
    return json(res, 200, { ok: true });
  }
  const body = await readJson(req);
  const text = String(body.body || "").trim().slice(0, 2000);
  if (!text) return json(res, 400, { error: "التعليق فارغ" });
  const updated = await update("comments", "id=eq." + encodeURIComponent(commentId), {
    body: text,
    updated_at: new Date().toISOString(),
  });
  json(res, 200, updated?.[0] || { ok: true });
}

async function socialRecordReelView(req, res, reelId) {
  const user = await currentUser(req);
  const rows = await select(
    "reels",
    "select=id,author_id,visibility,moderation_status,deleted_at,view_count&id=eq." +
      encodeURIComponent(reelId) + "&limit=1",
  );
  const reel = rows?.[0];
  if (!reel || reel.deleted_at || reel.moderation_status !== "active") {
    return json(res, 404, { error: "الريلز غير متاح" });
  }
  if (!(await canViewContentOwner(user, reel.author_id, reel.visibility || "public"))) {
    return json(res, 403, { error: "لا يمكنك مشاهدة هذا الريلز" });
  }

  if (reel.author_id === user.id) {
    return json(res, 200, { ok: true, view_count: Number(reel.view_count || 0), own_view: true });
  }

  const result = await serviceRequest("/rest/v1/rpc/record_reel_view", {
    method: "POST",
    body: { p_reel_id: reelId, p_viewer_id: user.id },
  });
  const viewCount = Array.isArray(result) ? Number(result[0] || 0) : Number(result || 0);
  json(res, 200, { ok: true, view_count: viewCount });
}

async function socialPinComment(req, res, commentId) {
  const user = await currentUser(req);
  const body = await readJson(req);
  const rows = await select(
    "comments",
    "select=id,author_id,post_id,reel_id,parent_id,pinned_at,deleted_at,moderation_status&id=eq." +
      encodeURIComponent(commentId) + "&limit=1",
  );
  const comment = rows?.[0];
  if (!comment || comment.deleted_at || comment.moderation_status !== "active") {
    return json(res, 404, { error: "التعليق غير موجود" });
  }
  if (comment.parent_id) return json(res, 400, { error: "يمكن تثبيت تعليق رئيسي فقط" });

  const targetTable = comment.post_id ? "posts" : "reels";
  const targetId = comment.post_id || comment.reel_id;
  const content = await select(
    targetTable,
    "select=id,author_id&id=eq." + encodeURIComponent(targetId) + "&limit=1",
  );
  if (!content?.[0]) return json(res, 404, { error: "المحتوى غير موجود" });
  if (content[0].author_id !== user.id) {
    return json(res, 403, { error: "تثبيت التعليقات متاح لصاحب المحتوى فقط" });
  }

  const pinned = body.pinned !== false;
  const filterField = comment.post_id ? "post_id" : "reel_id";
  if (pinned) {
    await update(
      "comments",
      filterField + "=eq." + encodeURIComponent(targetId) + "&pinned_at=not.is.null",
      { pinned_at: null },
      { returning: false },
    ).catch(() => {});
  }
  const updated = await update(
    "comments",
    "id=eq." + encodeURIComponent(commentId),
    { pinned_at: pinned ? new Date().toISOString() : null },
  );
  json(res, 200, updated?.[0] || { ok: true, pinned });
}

async function socialDeleteAccount(req, res) {
  const token = bearer(req);
  const user = await currentUser(req);
  const body = await readJson(req);
  if (String(body.confirm || "") !== "DELETE") return json(res, 400, { error: "تأكيد حذف الحساب غير صحيح" });

  await update("profiles", "id=eq." + encodeURIComponent(user.id), {
    deleted_at: new Date().toISOString(),
    is_banned: true,
    ban_reason: "account_deleted",
  }, { returning: false }).catch(() => {});

  await writeAudit(user.id, "delete_own_account", "profile", user.id, {});

  if (token) {
    await serviceRequest("/auth/v1/logout?scope=global", {
      method: "POST",
      headers: { Authorization: "Bearer " + token },
    }).catch(() => {});
  }

  await serviceRequest("/auth/v1/admin/users/" + encodeURIComponent(user.id), { method: "DELETE" });
  json(res, 200, { ok: true });
}

async function adminStats(req, res) {
  await requireAdmin(req, "analytics");
  const since24h = new Date(Date.now() - 24 * 3600_000).toISOString();
  const since7d = new Date(Date.now() - 7 * 24 * 3600_000).toISOString();
  const [
    users, posts, reels, stories, comments, openReports, openSupport, failedUploads, openErrors,
    newUsers24h, posts24h, reels24h, comments24h, active7d, recent
  ] = await Promise.all([
    count("profiles"),
    count("posts"),
    count("reels"),
    count("stories"),
    count("comments"),
    count("reports", "status=in.(open,review)"),
    count("support_tickets", "status=in.(open,in_progress,answered)"),
    count("upload_jobs", "status=eq.failed"),
    count("system_errors", "status=eq.new"),
    count("profiles", "created_at=gte." + encodeURIComponent(since24h)),
    count("posts", "created_at=gte." + encodeURIComponent(since24h)),
    count("reels", "created_at=gte." + encodeURIComponent(since24h)),
    count("comments", "created_at=gte." + encodeURIComponent(since24h)),
    count("profiles", "last_seen_at=gte." + encodeURIComponent(since7d)),
    select("reports", "select=id,reason,target_type,status,created_at&order=created_at.desc&limit=6"),
  ]);
  json(res, 200, {
    users, posts, reels, stories, comments,
    open_reports: openReports,
    open_support: openSupport,
    failed_uploads: failedUploads,
    open_errors: openErrors,
    today: {
      new_users: newUsers24h,
      posts: posts24h,
      reels: reels24h,
      comments: comments24h,
    },
    active_7d: active7d,
    recent_reports: recent || [],
  });
}


function pageParams(url, defaultLimit = 30, maxLimit = 100) {
  const page = Math.max(1, Math.floor(Number(url.searchParams.get("page") || 1)));
  const limit = Math.max(1, Math.min(maxLimit, Math.floor(Number(url.searchParams.get("limit") || defaultLimit))));
  return { page, limit, offset: (page - 1) * limit };
}

async function mediaReferenceCount(mediaId) {
  const id = encodeURIComponent(mediaId);
  const counts = await Promise.all([
    count("post_media", "media_id=eq." + id),
    count("reels", "media_id=eq." + id),
    count("reels", "cover_media_id=eq." + id),
    count("stories", "media_id=eq." + id),
    count("profiles", "avatar_media_id=eq." + id),
    count("profiles", "cover_media_id=eq." + id),
    count("messages", "media_id=eq." + id),
    count("conversations", "image_media_id=eq." + id),
  ]);
  return counts.reduce((sum, value) => sum + Number(value || 0), 0);
}

async function clearCachedMedia(mediaId) {
  const names = await fsp.readdir(cacheDir).catch(() => []);
  await Promise.all(
    names
      .filter((name) => name === mediaId || name.startsWith(mediaId + ".") || name.startsWith(mediaId + "-"))
      .map((name) => fsp.rm(path.join(cacheDir, name), { force: true }).catch(() => {})),
  );
}

async function queueMediaCleanup(media, requestedBy = null) {
  const existing = await select(
    "media_cleanup_jobs",
    "select=id,status,attempts&channel_key=eq." + encodeURIComponent(media.channel_key) +
      "&telegram_message_id=eq." + encodeURIComponent(media.telegram_message_id) +
      "&status=in.(pending,processing,failed)&limit=1",
  ).catch(() => []);
  if (existing?.[0]) return existing[0];
  const rows = await insert("media_cleanup_jobs", {
    media_id: media.id,
    channel_key: media.channel_key,
    telegram_message_id: media.telegram_message_id,
    requested_by: requestedBy || null,
    status: "pending",
    attempts: 0,
  });
  return rows?.[0] || null;
}

async function executeMediaCleanupJob(job) {
  const channels = await select(
    "storage_channels",
    "select=channel_id&channel_key=eq." + encodeURIComponent(job.channel_key) + "&limit=1",
  );
  const channel = channels?.[0];
  if (!channel) throw new Error("قناة التخزين غير موجودة");
  await deleteChannelMessage({
    channelId: channel.channel_id,
    messageId: job.telegram_message_id,
  });
  await update("media_cleanup_jobs", "id=eq." + encodeURIComponent(job.id), {
    status: "completed",
    attempts: Number(job.attempts || 0) + 1,
    last_error: null,
    updated_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
  }, { returning: false });
  return { ok: true };
}

async function purgeMediaObject(mediaId, requestedBy = null) {
  const rows = await select(
    "media_objects",
    "select=id,channel_key,telegram_message_id,status&id=eq." + encodeURIComponent(mediaId) + "&limit=1",
  ).catch(() => []);
  const media = rows?.[0];
  if (!media) return { media_id: mediaId, status: "missing" };

  const references = await mediaReferenceCount(mediaId);
  if (references > 0) {
    return { media_id: mediaId, status: "kept", references };
  }

  const job = await queueMediaCleanup(media, requestedBy);
  await remove("media_objects", "id=eq." + encodeURIComponent(mediaId)).catch((error) => {
    error.message = "تعذر حذف سجل الوسائط: " + error.message;
    throw error;
  });
  await clearCachedMedia(mediaId);

  try {
    await executeMediaCleanupJob(job);
    return { media_id: mediaId, status: "deleted", cleanup_job_id: job?.id || null };
  } catch (error) {
    await update("media_cleanup_jobs", "id=eq." + encodeURIComponent(job.id), {
      status: "failed",
      attempts: Number(job.attempts || 0) + 1,
      last_error: String(error.message || error).slice(0, 1000),
      updated_at: new Date().toISOString(),
    }, { returning: false }).catch(() => {});
    return {
      media_id: mediaId,
      status: "cleanup_pending",
      cleanup_job_id: job?.id || null,
      error: String(error.message || error),
    };
  }
}

async function processMediaCleanupJobs() {
  if (!readiness().database) return;
  const jobs = await select(
    "media_cleanup_jobs",
    "select=id,media_id,channel_key,telegram_message_id,status,attempts,last_error&status=in.(pending,failed)&attempts=lt.5&order=created_at.asc&limit=10",
  ).catch(() => []);
  for (const job of jobs || []) {
    try {
      await update("media_cleanup_jobs", "id=eq." + encodeURIComponent(job.id), {
        status: "processing",
        updated_at: new Date().toISOString(),
      }, { returning: false });
      await executeMediaCleanupJob(job);
    } catch (error) {
      await update("media_cleanup_jobs", "id=eq." + encodeURIComponent(job.id), {
        status: "failed",
        attempts: Number(job.attempts || 0) + 1,
        last_error: String(error.message || error).slice(0, 1000),
        updated_at: new Date().toISOString(),
      }, { returning: false }).catch(() => {});
    }
  }
}

async function ownedMediaIds(userId) {
  const rows = await select(
    "media_objects",
    "select=id&owner_id=eq." + encodeURIComponent(userId) + "&limit=10000",
  ).catch(() => []);
  return [...new Set((rows || []).map((row) => row.id).filter(Boolean))];
}

async function adminUsers(req, res, url) {
  await requireAdmin(req, "users");
  const cleanupNow = new Date().toISOString();
  await update(
    "profiles",
    "banned_until=not.is.null&banned_until=lte." + encodeURIComponent(cleanupNow),
    { is_banned: false, banned_until: null, ban_reason: "" },
    { returning: false },
  ).catch(() => {});
  const { page, limit, offset } = pageParams(url, 30, 80);
  const q = (url.searchParams.get("q") || "").trim().replace(/[,*()]/g, "");
  const status = String(url.searchParams.get("status") || "").trim();
  const verified = String(url.searchParams.get("verified") || "").trim();
  const privacy = String(url.searchParams.get("privacy") || "").trim();

  const filters = [];
  if (q) {
    const parts = [
      "name.ilike.*" + encodeURIComponent(q) + "*",
      "username.ilike.*" + encodeURIComponent(q.replace(/^@/, "")) + "*",
    ];
    if (/^[0-9a-f-]{36}$/i.test(q)) parts.push("id.eq." + encodeURIComponent(q));
    filters.push("or=(" + parts.join(",") + ")");
  }
  const nowIso = new Date().toISOString();
  if (status === "active") {
    filters.push(
      "deleted_at=is.null",
      "is_banned=eq.false",
      "or=(banned_until.is.null,banned_until.lte." + encodeURIComponent(nowIso) + ")"
    );
  } else if (status === "banned") {
    filters.push(
      "deleted_at=is.null",
      "or=(is_banned.eq.true,banned_until.gt." + encodeURIComponent(nowIso) + ")"
    );
  } else if (status === "deleted") {
    filters.push("deleted_at=not.is.null");
  }
  if (verified === "true" || verified === "false") filters.push("is_verified=eq." + verified);
  if (privacy === "private") filters.push("is_private=eq.true");
  if (privacy === "public") filters.push("is_private=eq.false");

  const suffix = filters.length ? "&" + filters.join("&") : "";
  const total = await count("profiles", filters.join("&"));
  const query =
    "select=id,name,username,avatar_media_id,is_banned,is_verified,is_private,banned_until,ban_reason,warning_count,last_seen_at,deleted_at,created_at" +
    suffix +
    "&order=created_at.desc&offset=" + offset + "&limit=" + limit;
  const items = await select("profiles", query);
  json(res, 200, {
    items: items || [],
    pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
  });
}

async function setBan(req, res, userId) {
  const actor = await requireAdmin(req, "users");
  const body = await readJson(req);
  const banned = Boolean(body.banned);
  const hours = Number(body.duration_hours || 0);
  const temporary = banned && Number.isFinite(hours) && hours > 0;
  const bannedUntil = temporary
    ? new Date(Date.now() + Math.min(hours, 24 * 365) * 3600_000).toISOString()
    : null;
  const reason = String(body.reason || "").trim().slice(0, 500);
  await update(
    "profiles",
    "id=eq." + encodeURIComponent(userId),
    {
      is_banned: banned && !temporary,
      banned_until: bannedUntil,
      ban_reason: banned ? reason : "",
    },
    { returning: false },
  );
  if (banned) {
    await serviceRequest("/rest/v1/rpc/admin_revoke_user_sessions", {
      method: "POST",
      body: { p_user_id: userId },
    }).catch(() => {});
  }
  await writeAudit(actor.user.id, banned ? "ban_user" : "unban_user", "profile", userId, {
    reason,
    duration_hours: temporary ? hours : null,
    banned_until: bannedUntil,
  });
  json(res, 200, { ok: true, banned, banned_until: bannedUntil, permanent: banned && !temporary });
}

async function adminUserDetail(req, res, userId) {
  await requireAdmin(req, "users");
  const profiles = await select(
    "profiles",
    "select=id,name,username,bio,profile_link,avatar_media_id,cover_media_id,is_private,is_verified,is_banned,banned_until,ban_reason,warning_count,last_seen_at,deleted_at,created_at,updated_at&id=eq." + encodeURIComponent(userId) + "&limit=1",
  );
  const profile = profiles?.[0];
  if (!profile) return json(res, 404, { error: "الحساب غير موجود" });

  const [posts, reels, stories, comments, followers, following, reports, warnings, authRecord] = await Promise.all([
    count("posts", "author_id=eq." + encodeURIComponent(userId)),
    count("reels", "author_id=eq." + encodeURIComponent(userId)),
    count("stories", "author_id=eq." + encodeURIComponent(userId)),
    count("comments", "author_id=eq." + encodeURIComponent(userId)),
    count("follows", "following_id=eq." + encodeURIComponent(userId) + "&status=eq.accepted"),
    count("follows", "follower_id=eq." + encodeURIComponent(userId) + "&status=eq.accepted"),
    count("reports", "target_type=eq.profile&target_id=eq." + encodeURIComponent(userId)),
    select(
      "admin_user_warnings",
      "select=id,admin_user_id,reason,created_at&user_id=eq." + encodeURIComponent(userId) + "&order=created_at.desc&limit=30",
    ).catch(() => []),
    serviceRequest("/auth/v1/admin/users/" + encodeURIComponent(userId)).catch(() => null),
  ]);

  json(res, 200, {
    profile,
    auth: authRecord ? {
      email: authRecord.email || "",
      phone: authRecord.phone || "",
      last_sign_in_at: authRecord.last_sign_in_at || null,
      email_confirmed_at: authRecord.email_confirmed_at || null,
      created_at: authRecord.created_at || null,
    } : null,
    warnings: warnings || [],
    stats: { posts, reels, stories, comments, followers, following, reports },
  });
}

async function adminUserAction(req, res, userId) {
  const actor = await requireAdmin(req, "users");
  const body = await readJson(req);
  const action = String(body.action || "");
  const reason = String(body.reason || "").trim().slice(0, 500);

  if (action === "verify" || action === "unverify") {
    await update("profiles", "id=eq." + encodeURIComponent(userId), {
      is_verified: action === "verify",
    }, { returning: false });
  } else if (action === "warn") {
    if (!reason) return json(res, 400, { error: "نص التحذير مطلوب" });
    const rows = await select("profiles", "select=warning_count&id=eq." + encodeURIComponent(userId) + "&limit=1");
    if (!rows?.[0]) return json(res, 404, { error: "الحساب غير موجود" });
    await insert("admin_user_warnings", {
      user_id: userId,
      admin_user_id: actor.user.id,
      reason,
    }, { returning: false });
    await update("profiles", "id=eq." + encodeURIComponent(userId), {
      warning_count: Number(rows[0].warning_count || 0) + 1,
    }, { returning: false });
    const title = "تنبيه من إدارة آشور";
    await insert("notifications", {
      user_id: userId,
      actor_id: actor.user.id,
      kind: "system",
      title,
      body: reason,
    }, { returning: false }).catch(() => {});
    await sendPush({ userIds: [userId], title, body: reason, data: { kind: "system" } }).catch(() => {});
  } else if (action === "notify") {
    const title = String(body.title || "رسالة من إدارة آشور").trim().slice(0, 80);
    const message = String(body.message || "").trim().slice(0, 500);
    if (!message) return json(res, 400, { error: "نص الإشعار مطلوب" });
    await insert("notifications", {
      user_id: userId,
      actor_id: actor.user.id,
      kind: "system",
      title,
      body: message,
    }, { returning: false });
    await sendPush({ userIds: [userId], title, body: message, data: { kind: "system" } }).catch(() => {});
  } else if (action === "force_logout") {
    const result = await serviceRequest("/rest/v1/rpc/admin_revoke_user_sessions", {
      method: "POST",
      body: { p_user_id: userId },
    });
    await writeAudit(actor.user.id, "force_logout_user", "profile", userId, {
      sessions_revoked: Number(Array.isArray(result) ? result[0] : result || 0),
    });
    return json(res, 200, { ok: true, sessions_revoked: Number(Array.isArray(result) ? result[0] : result || 0) });
  } else if (action === "deactivate") {
    await update("profiles", "id=eq." + encodeURIComponent(userId), {
      deleted_at: new Date().toISOString(),
      is_banned: true,
      banned_until: null,
      ban_reason: reason || "admin_deactivated",
    }, { returning: false });
    await serviceRequest("/rest/v1/rpc/admin_revoke_user_sessions", {
      method: "POST",
      body: { p_user_id: userId },
    }).catch(() => {});
  } else if (action === "reactivate") {
    await update("profiles", "id=eq." + encodeURIComponent(userId), {
      deleted_at: null,
      is_banned: false,
      banned_until: null,
      ban_reason: "",
    }, { returning: false });
  } else if (action === "unban") {
    await update("profiles", "id=eq." + encodeURIComponent(userId), {
      is_banned: false,
      banned_until: null,
      ban_reason: "",
    }, { returning: false });
  } else {
    return json(res, 400, { error: "الإجراء غير مدعوم" });
  }

  await writeAudit(actor.user.id, "user_" + action, "profile", userId, { reason });
  json(res, 200, { ok: true });
}

async function adminDeleteUser(req, res, userId) {
  const actor = await requireAdmin(req, "users");
  if (actor.user.id === userId) return json(res, 400, { error: "لا يمكن حذف حساب الإدارة الحالي" });
  const body = await readJson(req);
  if (String(body.confirm || "") !== "DELETE") {
    return json(res, 400, { error: "تأكيد الحذف النهائي غير صحيح" });
  }
  const profileRows = await select(
    "profiles",
    "select=id,name,username&id=eq." + encodeURIComponent(userId) + "&limit=1",
  );
  const profile = profileRows?.[0];
  if (!profile) return json(res, 404, { error: "الحساب غير موجود" });

  const mediaIds = await ownedMediaIds(userId);
  await serviceRequest("/auth/v1/admin/users/" + encodeURIComponent(userId), { method: "DELETE" });

  const cleanup = [];
  for (const mediaId of mediaIds) {
    cleanup.push(await purgeMediaObject(mediaId, actor.user.id).catch((error) => ({
      media_id: mediaId,
      status: "cleanup_pending",
      error: String(error.message || error),
    })));
  }

  await writeAudit(actor.user.id, "delete_user_permanently", "profile", userId, {
    username: profile.username || "",
    media_count: mediaIds.length,
    cleanup,
  });
  json(res, 200, { ok: true, media_count: mediaIds.length, cleanup });
}

async function adminComments(req, res, url) {
  await requireAdmin(req, "content");
  const { page, limit, offset } = pageParams(url, 40, 100);
  const q = String(url.searchParams.get("q") || "").trim().replace(/[,*()]/g, "");
  const status = String(url.searchParams.get("status") || "").trim();
  const filters = [];
  if (q) filters.push("body=ilike.*" + encodeURIComponent(q) + "*");
  if (status) filters.push("moderation_status=eq." + encodeURIComponent(status));
  const filterQuery = filters.join("&");
  const total = await count("comments", filterQuery);
  let query = "select=id,author_id,post_id,reel_id,parent_id,body,moderation_status,deleted_at,created_at,updated_at,pinned_at";
  if (filterQuery) query += "&" + filterQuery;
  query += "&order=created_at.desc&offset=" + offset + "&limit=" + limit;
  const rows = await select("comments", query);
  const items = [];
  for (const row of rows || []) {
    const p = await select(
      "profiles",
      "select=id,name,username,avatar_media_id,is_verified&id=eq." + encodeURIComponent(row.author_id) + "&limit=1",
    ).catch(() => []);
    items.push({ ...row, author: p?.[0] || null });
  }
  json(res, 200, {
    items,
    pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
  });
}

async function moderateContent(req, res, kind, id) {
  const actor = await requireAdmin(req, "content");
  const table = ({ posts: "posts", reels: "reels", stories: "stories", comments: "comments" })[kind];
  if (!table) return json(res, 400, { error: "نوع المحتوى غير صالح" });
  const body = await readJson(req);
  const status = ["active", "hidden"].includes(body.status) ? body.status : "active";
  const patch = {
    moderation_status: status,
    hidden_by: status === "hidden" ? actor.user.id : null,
    deleted_at: null,
  };
  if (body.comments_enabled !== undefined && ["posts", "reels"].includes(kind)) {
    patch.comments_enabled = Boolean(body.comments_enabled);
  }
  await update(table, "id=eq." + encodeURIComponent(id), patch, { returning: false });
  await writeAudit(actor.user.id, status === "hidden" ? "hide_content" : "restore_content", kind, id, {
    reason: String(body.reason || "").slice(0, 500),
  });
  json(res, 200, { ok: true, status });
}

async function reportEvent(reportId, actorUserId, eventType, note = "", payload = {}) {
  return insert("report_events", {
    report_id: reportId,
    actor_user_id: actorUserId || null,
    event_type: String(eventType || "update").slice(0, 80),
    note: String(note || "").slice(0, 1500),
    payload: payload && typeof payload === "object" ? payload : {},
  }, { returning: false }).catch(() => {});
}

async function reportTargetSnapshot(targetType, targetId) {
  if (targetType === "profile") {
    const rows = await select(
      "profiles",
      "select=id,name,username,bio,avatar_media_id,cover_media_id,is_private,is_verified,is_banned,banned_until,deleted_at,created_at&id=eq." +
        encodeURIComponent(targetId) + "&limit=1",
    ).catch(() => []);
    const row = rows?.[0];
    if (!row) return { type: targetType, id: targetId, missing: true, media_ids: [] };
    return {
      type: targetType, id: targetId, author_id: row.id,
      title: row.name || row.username || "حساب",
      text: row.bio || "",
      media_ids: [row.avatar_media_id, row.cover_media_id].filter(Boolean),
      data: row,
    };
  }

  if (targetType === "post") {
    const rows = await select(
      "posts",
      "select=id,author_id,caption,moderation_status,visibility,comments_enabled,created_at,deleted_at&id=eq." + encodeURIComponent(targetId) + "&limit=1",
    ).catch(() => []);
    const row = rows?.[0];
    if (!row) return { type: targetType, id: targetId, missing: true, media_ids: [] };
    const media = await select("post_media", "select=media_id,sort_order&post_id=eq." + encodeURIComponent(targetId) + "&order=sort_order.asc").catch(() => []);
    return { type: targetType, id: targetId, author_id: row.author_id, title: "منشور", text: row.caption || "", media_ids: (media || []).map(x => x.media_id), data: row };
  }

  if (targetType === "reel") {
    const rows = await select(
      "reels",
      "select=id,author_id,caption,media_id,cover_media_id,moderation_status,visibility,comments_enabled,view_count,created_at,deleted_at&id=eq." + encodeURIComponent(targetId) + "&limit=1",
    ).catch(() => []);
    const row = rows?.[0];
    if (!row) return { type: targetType, id: targetId, missing: true, media_ids: [] };
    return { type: targetType, id: targetId, author_id: row.author_id, title: "ريلز", text: row.caption || "", media_ids: [...new Set([row.media_id,row.cover_media_id].filter(Boolean))], data: row };
  }

  if (targetType === "story") {
    const rows = await select(
      "stories",
      "select=id,author_id,caption,media_id,moderation_status,created_at,expires_at,deleted_at&id=eq." + encodeURIComponent(targetId) + "&limit=1",
    ).catch(() => []);
    const row = rows?.[0];
    if (!row) return { type: targetType, id: targetId, missing: true, media_ids: [] };
    return { type: targetType, id: targetId, author_id: row.author_id, title: "قصة", text: row.caption || "", media_ids: [row.media_id].filter(Boolean), data: row };
  }

  if (targetType === "comment") {
    const rows = await select(
      "comments",
      "select=id,author_id,post_id,reel_id,body,moderation_status,created_at,deleted_at&id=eq." + encodeURIComponent(targetId) + "&limit=1",
    ).catch(() => []);
    const row = rows?.[0];
    if (!row) return { type: targetType, id: targetId, missing: true, media_ids: [] };
    return { type: targetType, id: targetId, author_id: row.author_id, title: "تعليق", text: row.body || "", media_ids: [], data: row };
  }

  if (targetType === "message") {
    const rows = await select(
      "messages",
      "select=id,sender_id,conversation_id,body,media_id,shared_type,shared_id,is_deleted,created_at&id=eq." + encodeURIComponent(targetId) + "&limit=1",
    ).catch(() => []);
    const row = rows?.[0];
    if (!row) return { type: targetType, id: targetId, missing: true, media_ids: [] };
    return { type: targetType, id: targetId, author_id: row.sender_id, title: "رسالة", text: row.body || "", media_ids: [row.media_id].filter(Boolean), data: row };
  }

  return { type: targetType, id: targetId, missing: true, media_ids: [] };
}

async function reportTargetAuthorProfile(snapshot) {
  if (!snapshot?.author_id) return null;
  const rows = await select(
    "profiles",
    "select=id,name,username,avatar_media_id,is_verified,is_banned,banned_until,deleted_at&id=eq." +
      encodeURIComponent(snapshot.author_id) + "&limit=1",
  ).catch(() => []);
  return rows?.[0] || null;
}

async function deleteReportedTarget(actorUserId, targetType, targetId) {
  if (targetType === "comment") {
    await remove("comments", "id=eq." + encodeURIComponent(targetId));
    return { ok: true, media_count: 0, cleanup: [] };
  }
  if (targetType === "message") {
    const rows = await select(
      "messages",
      "select=id,media_id&is_deleted=eq.false&id=eq." + encodeURIComponent(targetId) + "&limit=1",
    ).catch(() => []);
    const message = rows?.[0];
    if (!message) return { ok: true, missing: true, soft_deleted: true, media_count: 0, cleanup: [] };
    await update("messages", "id=eq." + encodeURIComponent(targetId), {
      is_deleted: true,
      body: "",
      media_id: null,
      edited_at: new Date().toISOString(),
    }, { returning: false });
    const cleanup = [];
    if (message.media_id) {
      cleanup.push(await purgeMediaObject(message.media_id, actorUserId).catch(error => ({
        media_id: message.media_id,
        status: "cleanup_pending",
        error: String(error.message || error),
      })));
    }
    return { ok: true, soft_deleted: true, media_count: message.media_id ? 1 : 0, cleanup };
  }
  const table = ({ post: "posts", reel: "reels", story: "stories" })[targetType];
  if (!table) throw Object.assign(new Error("هذا النوع لا يدعم الحذف من مركز البلاغات"), { statusCode: 400 });

  const fields = table === "posts" ? "id,author_id" : table === "reels" ? "id,author_id,media_id,cover_media_id" : "id,author_id,media_id";
  const rows = await select(table, "select=" + fields + "&id=eq." + encodeURIComponent(targetId) + "&limit=1");
  const content = rows?.[0];
  if (!content) return { ok: true, missing: true, media_count: 0, cleanup: [] };

  let mediaIds = [];
  if (targetType === "post") {
    const media = await select("post_media", "select=media_id&post_id=eq." + encodeURIComponent(targetId)).catch(() => []);
    mediaIds = (media || []).map(x => x.media_id);
  } else {
    if (content.media_id) mediaIds.push(content.media_id);
    if (content.cover_media_id && content.cover_media_id !== content.media_id) mediaIds.push(content.cover_media_id);
  }
  mediaIds = [...new Set(mediaIds.filter(Boolean))];
  await remove(table, "id=eq." + encodeURIComponent(targetId));
  const cleanup = [];
  for (const mediaId of mediaIds) {
    cleanup.push(await purgeMediaObject(mediaId, actorUserId).catch(error => ({
      media_id: mediaId,
      status: "cleanup_pending",
      error: String(error.message || error),
    })));
  }
  return { ok: true, media_count: mediaIds.length, cleanup };
}

async function warnReportedUser(actor, userId, reason) {
  if (!userId) return false;
  const rows = await select("profiles", "select=id,warning_count&id=eq." + encodeURIComponent(userId) + "&limit=1");
  if (!rows?.[0]) return false;
  const message = String(reason || "تم تسجيل مخالفة على حسابك.").trim().slice(0, 500);
  await insert("admin_user_warnings", {
    user_id: userId,
    admin_user_id: actor.user.id,
    reason: message,
  }, { returning: false });
  await update("profiles", "id=eq." + encodeURIComponent(userId), {
    warning_count: Number(rows[0].warning_count || 0) + 1,
  }, { returning: false });
  await insert("notifications", {
    user_id: userId,
    actor_id: actor.user.id,
    kind: "system",
    title: "تنبيه من إدارة آشور",
    body: message,
  }, { returning: false }).catch(() => {});
  await sendPush({
    userIds: [userId],
    title: "تنبيه من إدارة آشور",
    body: message,
    data: { kind: "system" },
  }).catch(() => {});
  return true;
}

async function banReportedUser(actor, userId, reason, hours) {
  if (!userId) return false;
  const ownerRows = await select(
    "admins",
    "select=user_id&user_id=eq." + encodeURIComponent(userId) + "&role=eq.owner&active=eq.true&limit=1",
  ).catch(() => []);
  if (userId === actor.user.id || ownerRows?.length) {
    const error = new Error("لا يمكن حظر حساب الإدارة الحالي أو حساب المالك من مركز البلاغات");
    error.statusCode = 400;
    throw error;
  }
  const duration = Math.max(0, Math.min(Number(hours || 0), 24 * 365));
  const temporary = duration > 0;
  const bannedUntil = temporary ? new Date(Date.now() + duration * 3600_000).toISOString() : null;
  await update("profiles", "id=eq." + encodeURIComponent(userId), {
    is_banned: !temporary,
    banned_until: bannedUntil,
    ban_reason: String(reason || "إجراء إداري بسبب بلاغ").slice(0, 500),
  }, { returning: false });
  await serviceRequest("/rest/v1/rpc/admin_revoke_user_sessions", {
    method: "POST",
    body: { p_user_id: userId },
  }).catch(() => {});
  return { temporary, banned_until: bannedUntil };
}

async function reportAction(req, res, reportId) {
  const actor = await requireAdmin(req, "reports");
  const body = await readJson(req);
  const rows = await select(
    "reports",
    "select=id,reporter_id,target_type,target_id,status,priority,assigned_to,admin_note&id=eq." +
      encodeURIComponent(reportId) + "&limit=1",
  );
  const report = rows?.[0];
  if (!report) return json(res, 404, { error: "البلاغ غير موجود" });

  const action = String(body.action || "update").slice(0, 80);
  const note = String(body.admin_note || "").trim().slice(0, 1500);
  const priority = body.priority !== undefined
    ? (["low","normal","high","urgent"].includes(body.priority) ? body.priority : null)
    : report.priority;
  if (!priority) return json(res, 400, { error: "أولوية البلاغ غير صالحة" });

  let assignedTo = report.assigned_to || null;
  if (body.assigned_to !== undefined) {
    if (body.assigned_to === "me") assignedTo = actor.user.id;
    else if (!body.assigned_to) assignedTo = null;
    else if (/^[0-9a-f-]{36}$/i.test(String(body.assigned_to))) {
      const candidate = String(body.assigned_to);
      const adminRows = await select(
        "admins",
        "select=user_id,active&user_id=eq." + encodeURIComponent(candidate) + "&active=eq.true&limit=1",
      ).catch(() => []);
      if (!adminRows?.[0]) {
        return json(res, 400, { error: "المشرف المحدد غير نشط" });
      }
      assignedTo = candidate;
    } else return json(res, 400, { error: "معرف المشرف غير صالح" });
  } else if (["review","hide_content","delete_content","warn_user","ban_user","restore_content"].includes(action) && !assignedTo) {
    assignedTo = actor.user.id;
  }

  const snapshot = await reportTargetSnapshot(report.target_type, report.target_id);
  const targetUserId = snapshot.author_id || null;
  const result = {};

  if (action === "hide_content" && ["post","reel","story","comment"].includes(report.target_type)) {
    const table = ({ post:"posts", reel:"reels", story:"stories", comment:"comments" })[report.target_type];
    await update(table, "id=eq." + encodeURIComponent(report.target_id), {
      moderation_status: "hidden",
      hidden_by: actor.user.id,
    }, { returning: false });
    result.hidden = true;
  } else if (action === "restore_content" && ["post","reel","story","comment"].includes(report.target_type)) {
    const table = ({ post:"posts", reel:"reels", story:"stories", comment:"comments" })[report.target_type];
    await update(table, "id=eq." + encodeURIComponent(report.target_id), {
      moderation_status: "active",
      hidden_by: null,
      deleted_at: null,
    }, { returning: false });
    result.restored = true;
  } else if (action === "delete_content") {
    Object.assign(result, await deleteReportedTarget(actor.user.id, report.target_type, report.target_id));
  } else if (action === "warn_user") {
    result.warned = await warnReportedUser(actor, targetUserId, note || "تم تسجيل مخالفة على محتوى في حسابك.");
  } else if (action === "ban_user") {
    result.ban = await banReportedUser(actor, targetUserId, note || "إجراء إداري بسبب بلاغ", body.duration_hours);
  }

  let status = report.status;
  if (body.status !== undefined) {
    if (!["open","review","resolved","rejected"].includes(body.status)) return json(res, 400, { error: "حالة البلاغ غير صالحة" });
    status = body.status;
  } else if (action === "review") status = "review";
  else if (["hide_content","delete_content","warn_user","ban_user"].includes(action)) status = "resolved";
  else if (action === "reject") status = "rejected";

  const patch = {
    status,
    priority,
    assigned_to: assignedTo,
    admin_note: note || report.admin_note || "",
    action_taken: action,
    handled_by: actor.user.id,
    updated_at: new Date().toISOString(),
    resolved_at: ["resolved","rejected"].includes(status) ? new Date().toISOString() : null,
  };
  if (status === "review" && report.status !== "review") patch.review_started_at = new Date().toISOString();
  await update("reports", "id=eq." + encodeURIComponent(reportId), patch, { returning: false });

  await reportEvent(reportId, actor.user.id, action, note, {
    status,
    priority,
    assigned_to: assignedTo,
    target_type: report.target_type,
    target_id: report.target_id,
    result,
  });
  await writeAudit(actor.user.id, "report_" + action, "report", reportId, {
    status,
    priority,
    target_type: report.target_type,
    target_id: report.target_id,
    result,
  });
  json(res, 200, { ok: true, status, priority, assigned_to: assignedTo, result });
}

async function adminCandidates(req, res, url) {
  const actor = await requireAdmin(req, "admins");
  if (!["owner","secondary_admin"].includes(actor.admin.role)) {
    return json(res, 403, { error: "إضافة المشرفين متاحة للإدارة العليا فقط" });
  }
  const q = String(url.searchParams.get("q") || "").trim().replace(/[,*()]/g, "").slice(0, 80);
  if (q.length < 2) return json(res, 200, { items: [] });

  let query = "select=id,name,username,avatar_media_id,is_verified,is_banned,banned_until,deleted_at&limit=20";
  if (/^[0-9a-f-]{36}$/i.test(q)) query += "&id=eq." + encodeURIComponent(q);
  else query += "&or=(username.ilike.*" + encodeURIComponent(q.replace(/^@/,"")) + "*,name.ilike.*" + encodeURIComponent(q) + "*)";

  const [profiles, adminRows] = await Promise.all([
    select("profiles", query).catch(() => []),
    select("admins", "select=user_id&limit=1000").catch(() => []),
  ]);
  const excluded = new Set((adminRows || []).map(x => x.user_id));

  const items = (profiles || []).filter(profile =>
    profile &&
    !excluded.has(profile.id) &&
    !profile.deleted_at &&
    !profile.is_banned &&
    !(profile.banned_until && new Date(profile.banned_until) > new Date())
  );
  json(res, 200, { items });
}

async function updateAdminRecord(req, res, adminUserId) {
  const actor = await requireAdmin(req, "admins");
  if (!["owner","secondary_admin"].includes(actor.admin.role)) {
    return json(res, 403, { error: "إدارة المشرفين متاحة للإدارة العليا فقط" });
  }

  const currentRows = await select(
    "admins",
    "select=user_id,role,permissions,active&user_id=eq." + encodeURIComponent(adminUserId) + "&limit=1",
  );
  const current = currentRows?.[0];
  if (!current) return json(res, 404, { error: "المشرف غير موجود" });
  if (current.role === "owner") {
    return json(res, 400, { error: "صلاحيات المالك لا يمكن تعديلها من إدارة المشرفين" });
  }

  const body = await readJson(req);
  const allowed = ["secondary_admin", "moderator", "content_moderator", "support", "analyst"];
  const patch = { updated_at: new Date().toISOString() };

  if (adminUserId === actor.user.id && (body.role !== undefined || body.active === false)) {
    return json(res, 400, { error: "لا يمكنك خفض دور حسابك أو تعطيله من الجلسة الحالية" });
  }

  if (body.role !== undefined) {
    if (!allowed.includes(body.role)) return json(res, 400, { error: "الدور غير صالح" });
    patch.role = body.role;
    if (body.role === "secondary_admin") patch.permissions = {};
  }
  if (body.permissions !== undefined && (body.role || current.role) !== "secondary_admin") {
    patch.permissions = sanitizeAdminPermissions(body.permissions);
  }
  if (body.active !== undefined) patch.active = Boolean(body.active);

  await update("admins", "user_id=eq." + encodeURIComponent(adminUserId), patch, { returning: false });
  await writeAudit(actor.user.id, "update_admin", "admin", adminUserId, {
    role: patch.role ?? current.role,
    permissions: patch.permissions ?? current.permissions,
    active: patch.active ?? current.active,
  });
  json(res, 200, { ok: true });
}

async function removeAdminRecord(req, res, adminUserId) {
  const actor = await requireAdmin(req, "admins");
  if (!["owner","secondary_admin"].includes(actor.admin.role)) {
    return json(res, 403, { error: "إدارة المشرفين متاحة للإدارة العليا فقط" });
  }
  if (adminUserId === actor.user.id) return json(res, 400, { error: "لا يمكنك حذف حسابك الإداري الحالي" });

  const rows = await select("admins", "select=user_id,role&user_id=eq." + encodeURIComponent(adminUserId) + "&limit=1");
  if (!rows?.[0]) return json(res, 404, { error: "المشرف غير موجود" });
  if (rows[0].role === "owner") return json(res, 400, { error: "لا يمكن حذف حساب المالك من إدارة المشرفين" });

  await remove("admins", "user_id=eq." + encodeURIComponent(adminUserId));
  await writeAudit(actor.user.id, "remove_admin", "admin", adminUserId, { role: rows[0].role });
  json(res, 200, { ok: true });
}

async function adminUploads(req, res, url) {
  await requireAdmin(req, "storage");
  const { page, limit, offset } = pageParams(url, 30, 80);
  const status = String(url.searchParams.get("status") || "").trim();
  const kind = String(url.searchParams.get("kind") || "").trim();
  const userRaw = String(url.searchParams.get("user") || "").trim();
  const q = String(url.searchParams.get("q") || "").trim().replace(/[,*()]/g, "");

  let userId = "";
  if (userRaw) {
    if (/^[0-9a-f-]{36}$/i.test(userRaw)) userId = userRaw;
    else {
      const username = userRaw.replace(/^@/,"").replace(/[,*()]/g,"");
      const profiles = await select(
        "profiles",
        "select=id&username=ilike." + encodeURIComponent(username) + "&limit=1",
      ).catch(() => []);
      userId = profiles?.[0]?.id || "__none__";
    }
  }

  const filters = [];
  if (status) filters.push("status=eq." + encodeURIComponent(status));
  if (kind) filters.push("kind=eq." + encodeURIComponent(kind));
  if (userId) filters.push("user_id=eq." + encodeURIComponent(userId));
  if (q) filters.push("original_name=ilike.*" + encodeURIComponent(q) + "*");
  const filterQuery = filters.join("&");

  const [total, queued, active, failed] = await Promise.all([
    count("upload_jobs", filterQuery),
    count("upload_jobs", "status=eq.queued"),
    count("upload_jobs", "status=in.(receiving,storing)"),
    count("upload_jobs", "status=eq.failed"),
  ]);

  let query = "select=id,client_upload_id,user_id,kind,original_name,mime_type,size_bytes,received_bytes,status,error,media_id,cancel_requested,failure_stage,retry_available,retry_expires_at,attempt_count,last_retry_at,created_at,updated_at,completed_at";
  if (filterQuery) query += "&" + filterQuery;
  query += "&order=created_at.desc&offset=" + offset + "&limit=" + limit;
  const rows = await select("upload_jobs", query);

  const items = [];
  for (const row of rows || []) {
    const profiles = row.user_id ? await select(
      "profiles",
      "select=id,name,username,avatar_media_id,is_verified&id=eq." + encodeURIComponent(row.user_id) + "&limit=1",
    ).catch(() => []) : [];
    const retryValid = Boolean(
      row.retry_available &&
      row.retry_expires_at &&
      new Date(row.retry_expires_at) > new Date()
    );
    items.push({ ...row, retry_available: retryValid, user: profiles?.[0] || null });
  }

  json(res, 200, {
    items,
    pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
    summary: {
      queued: Number(queued || 0),
      active: Number(active || 0),
      failed: Number(failed || 0),
    },
  });
}

async function adminCancelUpload(req, res, jobId) {
  const actor = await requireAdmin(req, "storage");
  const rows = await select("upload_jobs", "select=id,status&id=eq." + encodeURIComponent(jobId) + "&limit=1").catch(() => []);
  const job = rows?.[0];
  if (!job) return json(res, 404, { error: "عملية الرفع غير موجودة" });
  if (["completed","failed","cancelled"].includes(job.status)) {
    return json(res, 409, { error: "هذه العملية ليست قيد التنفيذ" });
  }
  await update("upload_jobs", "id=eq." + encodeURIComponent(jobId), {
    cancel_requested: true,
    updated_at: new Date().toISOString(),
  }, { returning: false });
  await writeAudit(actor.user.id, "cancel_upload", "upload_job", jobId, {});
  json(res, 200, { ok: true });
}

async function adminRetryUpload(req, res, jobId) {
  const actor = await requireAdmin(req, "storage");
  const rows = await select(
    "upload_jobs",
    "select=id,user_id,kind,original_name,mime_type,size_bytes,status,error,sha256,retry_available,retry_expires_at,attempt_count&" +
      "id=eq." + encodeURIComponent(jobId) + "&limit=1",
  );
  const job = rows?.[0];
  if (!job) return json(res, 404, { error: "عملية الرفع غير موجودة" });
  if (job.status !== "failed") return json(res, 409, { error: "إعادة المحاولة متاحة للعمليات الفاشلة فقط" });
  if (!job.retry_available || !job.retry_expires_at || new Date(job.retry_expires_at) <= new Date()) {
    await update("upload_jobs", "id=eq." + encodeURIComponent(jobId), {
      retry_available: false,
      retry_expires_at: null,
    }, { returning: false }).catch(() => {});
    return json(res, 409, { error: "انتهت صلاحية الملف المؤقت. يجب إعادة رفع الملف من التطبيق." });
  }

  const filePath = retryUploadCachePath(jobId);
  const stat = await fsp.stat(filePath).catch(() => null);
  if (!stat?.size) {
    await update("upload_jobs", "id=eq." + encodeURIComponent(jobId), {
      retry_available: false,
      retry_expires_at: null,
    }, { returning: false }).catch(() => {});
    return json(res, 409, { error: "الملف المؤقت لم يعد متوفرًا. يجب إعادة رفعه من التطبيق." });
  }

  const channelKey = CHANNELS[job.kind];
  if (!channelKey) return json(res, 400, { error: "نوع الملف غير مدعوم" });
  const channels = await select(
    "storage_channels",
    "select=channel_key,channel_id,enabled,status&channel_key=eq." + encodeURIComponent(channelKey) + "&limit=1",
  );
  const channel = channels?.[0];
  if (!channel?.enabled || channel.status !== "connected") {
    return json(res, 503, { error: "قناة التخزين لهذا النوع غير جاهزة" });
  }

  const now = new Date().toISOString();
  await update("upload_jobs", "id=eq." + encodeURIComponent(jobId), {
    status: "storing",
    error: null,
    cancel_requested: false,
    attempt_count: Math.max(1, Number(job.attempt_count || 1) + 1),
    last_retry_at: now,
    updated_at: now,
  }, { returning: false });

  let uploaded = null;
  let mediaCreated = false;
  try {
    const duplicates = job.sha256 ? await select(
      "media_objects",
      "select=*&owner_id=eq." + encodeURIComponent(job.user_id) +
        "&kind=eq." + encodeURIComponent(job.kind) +
        "&sha256=eq." + encodeURIComponent(job.sha256) +
        "&status=eq.ready&limit=1",
    ).catch(() => []) : [];

    if (duplicates?.[0]) {
      await update("upload_jobs", "id=eq." + encodeURIComponent(jobId), {
        media_id: duplicates[0].id,
        status: "completed",
        error: null,
        failure_stage: "",
        retry_available: false,
        retry_expires_at: null,
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, { returning: false });
      await fsp.rm(filePath, { force: true }).catch(() => {});
      await writeAudit(actor.user.id, "retry_upload", "upload_job", jobId, { duplicate: true });
      return json(res, 200, { ok: true, media_id: duplicates[0].id, duplicate: true });
    }

    uploaded = await uploadToChannel({
      channelId: channel.channel_id,
      filePath,
      caption: "آشور · " + job.kind + " · " + job.user_id + " · إعادة محاولة",
    });

    const mediaRows = await insert("media_objects", {
      owner_id: job.user_id || null,
      kind: job.kind,
      channel_key: channelKey,
      telegram_message_id: uploaded.messageId,
      telegram_file_id: uploaded.storageRef,
      original_name: String(job.original_name || "").slice(0,250),
      mime_type: String(job.mime_type || "application/octet-stream").slice(0,150),
      size_bytes: Number(stat.size || job.size_bytes || 0),
      sha256: job.sha256 || null,
      status: "ready",
    });
    const media = mediaRows?.[0] || {};
    mediaCreated = Boolean(media.id);

    await update("storage_channels", "channel_key=eq." + encodeURIComponent(channelKey), {
      last_upload_at: new Date().toISOString(),
      last_error: "",
    }, { returning: false }).catch(() => {});

    await update("upload_jobs", "id=eq." + encodeURIComponent(jobId), {
      media_id: media.id || null,
      received_bytes: Number(stat.size || job.size_bytes || 0),
      size_bytes: Number(stat.size || job.size_bytes || 0),
      status: "completed",
      error: null,
      failure_stage: "",
      retry_available: false,
      retry_expires_at: null,
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { returning: false });
    await fsp.rm(filePath, { force: true }).catch(() => {});
    await writeAudit(actor.user.id, "retry_upload", "upload_job", jobId, { media_id: media.id || null });
    json(res, 200, { ok: true, media_id: media.id || null });
  } catch (error) {
    if (uploaded && !mediaCreated) {
      await deleteChannelMessage({ channelId: channel.channel_id, messageId: uploaded.messageId }).catch(() => {});
    }
    const retryStillAvailable = Boolean(await fsp.stat(filePath).catch(() => null));
    await update("upload_jobs", "id=eq." + encodeURIComponent(jobId), {
      status: "failed",
      error: String(error.message || error).slice(0,1000),
      failure_stage: "storing",
      retry_available: retryStillAvailable,
      retry_expires_at: retryStillAvailable ? uploadRetryExpiry() : null,
      updated_at: new Date().toISOString(),
    }, { returning: false }).catch(() => {});
    await logSystemError("upload_retry", error, { job_id: jobId }, actor.user.id);
    throw error;
  }
}

async function adminErrors(req, res, url) {
  await requireAdmin(req, "storage");
  const { page, limit, offset } = pageParams(url, 30, 80);
  const status = String(url.searchParams.get("status") || "").trim();
  const service = String(url.searchParams.get("service") || "").trim();
  const severity = String(url.searchParams.get("severity") || "").trim();
  const q = String(url.searchParams.get("q") || "").trim().replace(/[,*()]/g, "");
  const filters = [];
  if (status) filters.push("status=eq." + encodeURIComponent(status));
  if (service) filters.push("service=eq." + encodeURIComponent(service));
  if (severity) filters.push("severity=eq." + encodeURIComponent(severity));
  if (q) {
    filters.push("or=(message.ilike.*" + encodeURIComponent(q) + "*,code.ilike.*" + encodeURIComponent(q) +
      "*,service.ilike.*" + encodeURIComponent(q) + "*)");
  }
  const filterQuery = filters.join("&");
  const total = await count("system_errors", filterQuery);
  let query = "select=id,service,code,message,severity,fingerprint,context,user_id,status,occurrence_count,first_seen_at,last_seen_at,created_at,resolved_at,resolved_by,resolution_note,updated_at";
  if (filterQuery) query += "&" + filterQuery;
  query += "&order=last_seen_at.desc.nullslast,created_at.desc&offset=" + offset + "&limit=" + limit;
  const [rows, openCount, criticalCount, recentCount, resolvedCount, openRows] = await Promise.all([
    select("system_errors", query),
    count("system_errors", "status=neq.resolved"),
    count("system_errors", "status=neq.resolved&severity=eq.critical"),
    count("system_errors", "last_seen_at=gte." + encodeURIComponent(new Date(Date.now() - 24 * 3600_000).toISOString())),
    count("system_errors", "status=eq.resolved"),
    select("system_errors", "select=service,severity,occurrence_count&status=neq.resolved&order=last_seen_at.desc&limit=1000").catch(() => []),
  ]);
  const serviceMap = new Map();
  for (const row of openRows || []) {
    const key = String(row.service || "system");
    const current = serviceMap.get(key) || { service: key, groups: 0, occurrences: 0, critical: 0 };
    current.groups += 1;
    current.occurrences += Math.max(1, Number(row.occurrence_count || 1));
    if (row.severity === "critical") current.critical += 1;
    serviceMap.set(key, current);
  }
  json(res, 200, {
    items: rows || [],
    pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
    summary: {
      open: openCount,
      critical: criticalCount,
      last_24h: recentCount,
      resolved: resolvedCount,
      services: [...serviceMap.values()].sort((a, b) => b.occurrences - a.occurrences),
    },
  });
}

async function resolveSystemError(req, res, errorId) {
  const actor = await requireAdmin(req, "storage");
  const body = await readJson(req).catch(() => ({}));
  const note = String(body.note || "").trim().slice(0, 1500);
  await update("system_errors", "id=eq." + encodeURIComponent(errorId), {
    status: "resolved",
    resolved_at: new Date().toISOString(),
    resolved_by: actor.user.id,
    resolution_note: note,
    updated_at: new Date().toISOString(),
  }, { returning: false });
  await writeAudit(actor.user.id, "resolve_system_error", "system_error", errorId, { note });
  json(res, 200, { ok: true });
}

async function reopenSystemError(req, res, errorId) {
  const actor = await requireAdmin(req, "storage");
  await update("system_errors", "id=eq." + encodeURIComponent(errorId), {
    status: "new",
    resolved_at: null,
    resolved_by: null,
    resolution_note: "",
    last_seen_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }, { returning: false });
  await writeAudit(actor.user.id, "reopen_system_error", "system_error", errorId, {});
  json(res, 200, { ok: true });
}

async function adminSupport(req, res, url) {
  const actor = await requireAdmin(req, "support");
  const { page, limit, offset } = pageParams(url, 30, 80);
  const status = String(url.searchParams.get("status") || "").trim();
  const priority = String(url.searchParams.get("priority") || "").trim();
  const category = String(url.searchParams.get("category") || "").trim();
  const assigned = String(url.searchParams.get("assigned") || "").trim();
  const unread = String(url.searchParams.get("unread") || "").trim();
  const q = String(url.searchParams.get("q") || "").trim().replace(/[,*()]/g, "");

  const filters = [];
  if (status) filters.push("status=eq." + encodeURIComponent(status));
  if (priority) filters.push("priority=eq." + encodeURIComponent(priority));
  if (category) filters.push("category=eq." + encodeURIComponent(category));
  if (unread === "true" || unread === "false") filters.push("unread_by_admin=eq." + unread);
  if (assigned === "me") filters.push("assigned_to=eq." + encodeURIComponent(actor.user.id));
  else if (assigned === "unassigned") filters.push("assigned_to=is.null");
  else if (/^[0-9a-f-]{36}$/i.test(assigned)) filters.push("assigned_to=eq." + encodeURIComponent(assigned));
  if (q) filters.push("or=(subject.ilike.*" + encodeURIComponent(q) + "*,body.ilike.*" + encodeURIComponent(q) + "*)");

  const filterQuery = filters.join("&");
  const total = await count("support_tickets", filterQuery);
  let query = "select=id,user_id,category,subject,body,status,priority,admin_reply,assigned_to,app_version,device_info,unread_by_admin,unread_by_user,last_message_at,last_user_reply_at,last_admin_reply_at,created_at,updated_at,closed_at";
  if (filterQuery) query += "&" + filterQuery;
  query += "&order=unread_by_admin.desc,last_message_at.desc.nullslast,created_at.desc&offset=" + offset + "&limit=" + limit;

  const rows = await select("support_tickets", query);
  const items = [];
  for (const row of rows || []) {
    const [userRows, assigneeRows] = await Promise.all([
      select("profiles", "select=id,name,username,avatar_media_id,is_verified,is_banned&id=eq." + encodeURIComponent(row.user_id) + "&limit=1").catch(() => []),
      row.assigned_to
        ? select("profiles", "select=id,name,username,avatar_media_id&id=eq." + encodeURIComponent(row.assigned_to) + "&limit=1").catch(() => [])
        : Promise.resolve([]),
    ]);
    items.push({
      ...row,
      user: userRows?.[0] || null,
      assignee: assigneeRows?.[0] || null,
    });
  }

  json(res, 200, {
    items,
    pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
  });
}

async function adminSupportDetail(req, res, ticketId) {
  await requireAdmin(req, "support");
  const rows = await select(
    "support_tickets",
    "select=id,user_id,category,subject,body,status,priority,admin_reply,assigned_to,app_version,device_info,resolution_note,unread_by_admin,unread_by_user,last_message_at,last_user_reply_at,last_admin_reply_at,created_at,updated_at,closed_at&id=eq." +
      encodeURIComponent(ticketId) + "&limit=1",
  );
  const ticket = rows?.[0];
  if (!ticket) return json(res, 404, { error: "تذكرة الدعم غير موجودة" });

  const [messages, events, userRows, assigneeRows] = await Promise.all([
    select("support_messages", "select=id,sender_kind,sender_user_id,body,created_at&ticket_id=eq." + encodeURIComponent(ticketId) + "&order=created_at.asc&limit=500").catch(() => []),
    select("support_events", "select=id,actor_user_id,event_type,note,payload,created_at&ticket_id=eq." + encodeURIComponent(ticketId) + "&order=created_at.asc&limit=500").catch(() => []),
    select("profiles", "select=id,name,username,avatar_media_id,is_verified,is_banned,last_seen_at,created_at&id=eq." + encodeURIComponent(ticket.user_id) + "&limit=1").catch(() => []),
    ticket.assigned_to
      ? select("profiles", "select=id,name,username,avatar_media_id&id=eq." + encodeURIComponent(ticket.assigned_to) + "&limit=1").catch(() => [])
      : Promise.resolve([]),
  ]);

  if (ticket.unread_by_admin) {
    await update("support_tickets", "id=eq." + encodeURIComponent(ticketId), {
      unread_by_admin: false,
      updated_at: new Date().toISOString(),
    }, { returning: false }).catch(() => {});
  }

  json(res, 200, {
    ticket: { ...ticket, unread_by_admin: false },
    user: userRows?.[0] || null,
    assignee: assigneeRows?.[0] || null,
    messages: messages || [],
    events: events || [],
  });
}

async function replySupport(req, res, ticketId) {
  const actor = await requireAdmin(req, "support");
  const body = await readJson(req);
  const rows = await select(
    "support_tickets",
    "select=id,user_id,status,priority,assigned_to,resolution_note&id=eq." + encodeURIComponent(ticketId) + "&limit=1",
  );
  const ticket = rows?.[0];
  if (!ticket) return json(res, 404, { error: "التذكرة غير موجودة" });

  const reply = String(body.reply || "").trim().slice(0, 4000);
  const nextStatus = body.status !== undefined
    ? (["open", "in_progress", "answered", "closed"].includes(body.status) ? body.status : null)
    : ticket.status;
  if (!nextStatus) return json(res, 400, { error: "حالة التذكرة غير صالحة" });

  const nextPriority = body.priority !== undefined
    ? (["low","normal","high","urgent"].includes(body.priority) ? body.priority : null)
    : ticket.priority;
  if (!nextPriority) return json(res, 400, { error: "أولوية التذكرة غير صالحة" });

  let nextAssigned = ticket.assigned_to || actor.user.id;
  if (body.assigned_to !== undefined) {
    if (body.assigned_to === "me") nextAssigned = actor.user.id;
    else if (!body.assigned_to) nextAssigned = null;
    else if (/^[0-9a-f-]{36}$/i.test(String(body.assigned_to))) {
      const adminRows = await select(
        "admins",
        "select=user_id,active&user_id=eq." + encodeURIComponent(body.assigned_to) + "&active=eq.true&limit=1",
      ).catch(() => []);
      if (!adminRows?.[0]) {
        return json(res, 400, { error: "المشرف المحدد غير نشط" });
      }
      nextAssigned = String(body.assigned_to);
    } else {
      return json(res, 400, { error: "معرف المشرف غير صالح" });
    }
  }

  const resolutionNote = body.resolution_note !== undefined
    ? String(body.resolution_note || "").trim().slice(0, 1500)
    : String(ticket.resolution_note || "");
  const now = new Date().toISOString();
  const patch = {
    status: nextStatus,
    priority: nextPriority,
    assigned_to: nextAssigned,
    resolution_note: resolutionNote,
    updated_at: now,
    closed_at: nextStatus === "closed" ? now : null,
    unread_by_admin: false,
  };

  if (reply) {
    await insert("support_messages", {
      ticket_id: ticketId,
      sender_kind: "admin",
      sender_user_id: actor.user.id,
      body: reply,
      created_at: now,
    }, { returning: false });
    patch.admin_reply = reply;
    patch.last_admin_reply_at = now;
    patch.last_message_at = now;
    patch.unread_by_user = true;
  } else if (nextStatus !== ticket.status) {
    patch.unread_by_user = true;
  }

  await update("support_tickets", "id=eq." + encodeURIComponent(ticketId), patch, { returning: false });

  const changes = {};
  if (nextStatus !== ticket.status) changes.status = { from: ticket.status, to: nextStatus };
  if (nextPriority !== ticket.priority) changes.priority = { from: ticket.priority, to: nextPriority };
  if ((nextAssigned || null) !== (ticket.assigned_to || null)) changes.assigned_to = nextAssigned || null;
  if (reply) changes.reply = true;
  await supportEvent(ticketId, actor.user.id, reply ? "admin_reply" : "admin_update", resolutionNote, changes);

  if (reply) {
    const title = "رد من دعم آشور";
    await insert("notifications", {
      user_id: ticket.user_id,
      actor_id: actor.user.id,
      kind: "support",
      title,
      body: reply.slice(0, 500),
      entity_type: "support_ticket",
      entity_id: ticketId,
    }, { returning: false }).catch(() => {});
    await sendPush({
      userIds: [ticket.user_id],
      title,
      body: reply.slice(0, 200),
      data: { kind: "support", ticket_id: ticketId },
    }).catch(() => {});
  } else if (nextStatus !== ticket.status) {
    const statusLabel = ({ open: "جديد", in_progress: "قيد المتابعة", answered: "تم الرد", closed: "مغلق" })[nextStatus] || nextStatus;
    const title = "تحديث على طلب الدعم";
    const message = "تم تحديث حالة طلب الدعم إلى: " + statusLabel;
    await insert("notifications", {
      user_id: ticket.user_id,
      actor_id: actor.user.id,
      kind: "support",
      title,
      body: message,
      entity_type: "support_ticket",
      entity_id: ticketId,
    }, { returning: false }).catch(() => {});
    await sendPush({
      userIds: [ticket.user_id],
      title,
      body: message,
      data: { kind: "support", ticket_id: ticketId },
    }).catch(() => {});
  }

  await writeAudit(actor.user.id, "update_support", "support_ticket", ticketId, {
    status: nextStatus,
    priority: nextPriority,
    assigned_to: nextAssigned,
    replied: Boolean(reply),
  });
  json(res, 200, { ok: true });
}

async function adminReleases(req, res) {
  const actor = await requireAdmin(req, "settings");
  if (req.method === "GET") {
    const [rows, publishedCount, testingCount, draftCount, retiredCount] = await Promise.all([
      select(
        "app_releases",
        "select=id,version,version_code,download_url,sha256,notes,update_message,required,minimum_version,status,created_by,updated_by,published_by,created_at,updated_at,published_at&order=version_code.desc,created_at.desc&limit=150",
      ),
      count("app_releases", "status=eq.published"),
      count("app_releases", "status=eq.testing"),
      count("app_releases", "status=eq.draft"),
      count("app_releases", "status=eq.retired"),
    ]);
    const items = rows || [];
    return json(res, 200, {
      items,
      summary: {
        total: items.length,
        published: publishedCount,
        testing: testingCount,
        draft: draftCount,
        retired: retiredCount,
        highest_version_code: items.reduce((max, row) => Math.max(max, Number(row.version_code || 0)), 0),
        current: items.find((row) => row.status === "published") || null,
      },
    });
  }

  const body = await readJson(req);
  const version = String(body.version || "").trim().slice(0, 40);
  const code = Number(body.version_code || 0);
  const status = ["draft", "testing", "published", "retired"].includes(body.status) ? body.status : "draft";
  const downloadUrl = String(body.download_url || "").trim().slice(0, 800);
  const sha256 = String(body.sha256 || "").trim().toLowerCase().slice(0, 64);
  const minimumVersion = String(body.minimum_version || version).trim().slice(0, 40);
  const notes = String(body.notes || "").trim().slice(0, 4000);
  const updateMessage = String(body.update_message || "").trim().slice(0, 1000);

  if (!validReleaseVersion(version) || !Number.isInteger(code) || code < 1) {
    return json(res, 400, { error: "تحقق من Version وVersion Code" });
  }
  if (minimumVersion && !validReleaseVersion(minimumVersion)) {
    return json(res, 400, { error: "أقل إصدار مسموح غير صالح" });
  }
  if (!validHttpUrl(downloadUrl)) return json(res, 400, { error: "رابط APK غير صالح" });
  if (sha256 && !validSha256(sha256)) return json(res, 400, { error: "SHA-256 يجب أن يكون 64 خانة" });
  if (status === "published" && (!downloadUrl || !validSha256(sha256))) {
    return json(res, 400, { error: "النشر يحتاج رابط APK وSHA-256 صالح" });
  }

  const rows = await insert("app_releases", {
    version,
    version_code: code,
    download_url: downloadUrl,
    sha256,
    notes,
    update_message: updateMessage,
    required: Boolean(body.required),
    minimum_version: minimumVersion,
    status: status === "published" ? "testing" : status,
    created_by: actor.user.id,
    updated_by: actor.user.id,
    updated_at: new Date().toISOString(),
    published_at: null,
  });
  const record = rows?.[0];
  await writeAudit(actor.user.id, "create_release", "app_release", record?.id || null, {
    version, version_code: code, status,
  });
  if (status === "published" && record) {
    await syncPublishedRelease({ ...record, status: "published" }, actor.user.id);
  }
  const fresh = record
    ? (await select("app_releases", "select=*&id=eq." + encodeURIComponent(record.id) + "&limit=1"))?.[0] || record
    : { ok: true };
  json(res, 201, fresh);
}

async function updateRelease(req, res, releaseId) {
  const actor = await requireAdmin(req, "settings");
  const rows = await select(
    "app_releases",
    "select=id,version,version_code,download_url,sha256,notes,update_message,required,minimum_version,status,created_at,published_at&id=eq." +
      encodeURIComponent(releaseId) + "&limit=1",
  );
  const current = rows?.[0];
  if (!current) return json(res, 404, { error: "الإصدار غير موجود" });

  const body = await readJson(req);
  const next = {
    ...current,
    version: body.version !== undefined ? String(body.version || "").trim().slice(0, 40) : current.version,
    version_code: body.version_code !== undefined ? Number(body.version_code || 0) : Number(current.version_code || 0),
    download_url: body.download_url !== undefined ? String(body.download_url || "").trim().slice(0, 800) : current.download_url,
    sha256: body.sha256 !== undefined ? String(body.sha256 || "").trim().toLowerCase().slice(0, 64) : current.sha256,
    notes: body.notes !== undefined ? String(body.notes || "").trim().slice(0, 4000) : current.notes,
    update_message: body.update_message !== undefined ? String(body.update_message || "").trim().slice(0, 1000) : current.update_message,
    minimum_version: body.minimum_version !== undefined ? String(body.minimum_version || "").trim().slice(0, 40) : current.minimum_version,
    required: body.required !== undefined ? Boolean(body.required) : Boolean(current.required),
    status: body.status !== undefined && ["draft","testing","published","retired"].includes(body.status) ? body.status : current.status,
  };

  if (!validReleaseVersion(next.version) || !Number.isInteger(next.version_code) || next.version_code < 1) {
    return json(res, 400, { error: "تحقق من Version وVersion Code" });
  }
  if (next.minimum_version && !validReleaseVersion(next.minimum_version)) {
    return json(res, 400, { error: "أقل إصدار مسموح غير صالح" });
  }
  if (!validHttpUrl(next.download_url)) return json(res, 400, { error: "رابط APK غير صالح" });
  if (next.sha256 && !validSha256(next.sha256)) return json(res, 400, { error: "SHA-256 يجب أن يكون 64 خانة" });
  if (next.status === "published" && (!next.download_url || !validSha256(next.sha256))) {
    return json(res, 400, { error: "النشر يحتاج رابط APK وSHA-256 صالح" });
  }

  const patch = {
    version: next.version,
    version_code: next.version_code,
    download_url: next.download_url,
    sha256: next.sha256,
    notes: next.notes,
    update_message: next.update_message,
    minimum_version: next.minimum_version,
    required: next.required,
    status: next.status === "published" ? current.status : next.status,
    updated_by: actor.user.id,
    updated_at: new Date().toISOString(),
  };
  if (next.status !== "published") {
    patch.published_at = next.status === "retired" ? current.published_at : null;
  }
  await update("app_releases", "id=eq." + encodeURIComponent(releaseId), patch, { returning: false });

  if (next.status === "published") {
    await syncPublishedRelease({ ...next, id: releaseId }, actor.user.id);
  } else {
    await writeAudit(actor.user.id, "update_release", "app_release", releaseId, {
      version: next.version,
      version_code: next.version_code,
      status: next.status,
      required: next.required,
    });
  }
  json(res, 200, { ok: true });
}

async function testStorageChannel(channel, force = false) {
  const now = new Date().toISOString();
  if (!channel.enabled && !force) {
    await update("storage_channels", "channel_key=eq." + encodeURIComponent(channel.channel_key), {
      status: "disabled",
      last_error: "",
      last_health_at: now,
      updated_at: now,
    }, { returning: false });
    return { ok: true, skipped: true, detail: "القناة معطلة" };
  }

  const result = await testTelegramChannel(channel.channel_id).catch((error) => ({
    ok: false,
    detail: String(error.message || error).slice(0,1000),
  }));
  await update("storage_channels", "channel_key=eq." + encodeURIComponent(channel.channel_key), {
    status: result.ok ? "connected" : "error",
    last_error: result.ok ? "" : String(result.detail || "فشل اختبار القناة").slice(0,1000),
    last_test_at: now,
    last_health_at: now,
    updated_at: now,
  }, { returning: false });
  return result;
}

async function testAdminChannel(req, res, channelKey) {
  const actor = await requireAdmin(req, "storage");
  const rows = await select(
    "storage_channels",
    "select=channel_key,channel_id,title,enabled&channel_key=eq." + encodeURIComponent(channelKey) + "&limit=1",
  );
  const channel = rows?.[0];
  if (!channel) return json(res, 404, { error: "القناة غير موجودة" });
  const result = await testStorageChannel(channel, true);
  await writeAudit(actor.user.id, "test_storage_channel", "storage_channel", channelKey, result);
  json(res, result.ok ? 200 : 503, result);
}

async function adminChannelAction(req, res, channelKey) {
  const actor = await requireAdmin(req, "storage");
  const rows = await select(
    "storage_channels",
    "select=channel_key,channel_id,title,enabled,status&channel_key=eq." + encodeURIComponent(channelKey) + "&limit=1",
  );
  const channel = rows?.[0];
  if (!channel) return json(res, 404, { error: "القناة غير موجودة" });

  const body = await readJson(req);
  const action = String(body.action || "").trim();
  if (!["enable","disable","test","reconnect"].includes(action)) {
    return json(res, 400, { error: "إجراء القناة غير صالح" });
  }

  if (action === "disable") {
    await update("storage_channels", "channel_key=eq." + encodeURIComponent(channelKey), {
      enabled: false,
      status: "disabled",
      last_error: "",
      last_health_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { returning: false });
    await writeAudit(actor.user.id, "disable_storage_channel", "storage_channel", channelKey, {});
    return json(res, 200, { ok: true, enabled: false });
  }

  if (action === "enable") {
    await update("storage_channels", "channel_key=eq." + encodeURIComponent(channelKey), {
      enabled: true,
      updated_at: new Date().toISOString(),
    }, { returning: false });
    const result = await testStorageChannel({ ...channel, enabled: true }, true);
    await writeAudit(actor.user.id, "enable_storage_channel", "storage_channel", channelKey, result);
    return json(res, result.ok ? 200 : 503, { ...result, enabled: true });
  }

  if (action === "reconnect") {
    await update("storage_channels", "channel_key=eq." + encodeURIComponent(channelKey), {
      enabled: true,
      status: "checking",
      last_error: "",
      updated_at: new Date().toISOString(),
    }, { returning: false });
    const result = await testStorageChannel({ ...channel, enabled: true }, true);
    await writeAudit(actor.user.id, "reconnect_storage_channel", "storage_channel", channelKey, result);
    return json(res, result.ok ? 200 : 503, { ...result, enabled: true });
  }

  const result = await testStorageChannel(channel, true);
  await writeAudit(actor.user.id, "test_storage_channel", "storage_channel", channelKey, result);
  json(res, result.ok ? 200 : 503, result);
}

async function adminTestAllChannels(req, res) {
  const actor = await requireAdmin(req, "storage");
  const rows = await select(
    "storage_channels",
    "select=channel_key,channel_id,title,enabled&order=channel_key.asc",
  );
  const results = [];
  for (const channel of rows || []) {
    const result = await testStorageChannel(channel);
    results.push({ channel_key: channel.channel_key, enabled: channel.enabled, ...result });
  }
  await writeAudit(actor.user.id, "test_all_storage_channels", "storage_channel", null, {
    total: results.length,
    ok: results.filter(x => x.ok).length,
    failed: results.filter(x => !x.ok).length,
  });
  json(res, results.every(x => x.ok) ? 200 : 207, { items: results });
}

async function adminNotificationHistory(req, res, url) {
  await requireAdmin(req, "notifications");
  const { page, limit, offset } = pageParams(url, 30, 80);
  const status = String(url.searchParams.get("status") || "").trim();
  const audience = String(url.searchParams.get("audience") || "").trim();
  const q = String(url.searchParams.get("q") || "").trim().replace(/[,*()]/g, "");
  const filters = [];
  if (status) filters.push("status=eq." + encodeURIComponent(status));
  if (audience) filters.push("audience=eq." + encodeURIComponent(audience));
  if (q) filters.push("or=(title.ilike.*" + encodeURIComponent(q) + "*,body.ilike.*" + encodeURIComponent(q) + "*)");
  const filterQuery = filters.join("&");
  const total = await count("admin_notification_history", filterQuery);
  let query = "select=id,actor_user_id,title,body,audience,target_user_id,target_user_ids,deep_link,scheduled_at,sent_at,status,push_result,recipient_count,failure_count,template_id,cancelled_at,created_at,updated_at";
  if (filterQuery) query += "&" + filterQuery;
  query += "&order=created_at.desc&offset=" + offset + "&limit=" + limit;
  const [rows, sent, failed, scheduled, cancelled] = await Promise.all([
    select("admin_notification_history", query),
    count("admin_notification_history", "status=eq.sent"),
    count("admin_notification_history", "status=eq.failed"),
    count("admin_notification_history", "status=eq.scheduled"),
    count("admin_notification_history", "status=eq.cancelled"),
  ]);
  json(res, 200, {
    items: rows || [],
    pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
    summary: { total, sent, failed, scheduled, cancelled },
  });
}

async function adminNotificationPreview(req, res, url) {
  await requireAdmin(req, "notifications");
  const audience = ["all", "user", "users", "verified", "active", "inactive"].includes(url.searchParams.get("audience"))
    ? url.searchParams.get("audience")
    : "all";
  const userId = String(url.searchParams.get("user_id") || "").trim();
  const userIds = String(url.searchParams.get("user_ids") || "")
    .split(",").map((x) => x.trim()).filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 500);
  const recipients = await notificationRecipients(audience, userId, userIds);
  let sample = [];
  if (recipients.ids.length) {
    const sampleIds = recipients.ids.slice(0, 8);
    sample = await select(
      "profiles",
      "select=id,name,username,avatar_media_id,is_verified,last_seen_at&id=in.(" +
        sampleIds.map((id) => encodeURIComponent(id)).join(",") + ")&limit=8",
    ).catch(() => []);
  }
  json(res, 200, { count: recipients.count, sample: sample || [] });
}

async function adminNotificationUsers(req, res, url) {
  await requireAdmin(req, "notifications");
  const q = String(url.searchParams.get("q") || "").trim().replace(/[,*()]/g, "");
  if (q.length < 2) return json(res, 200, { items: [] });
  const parts = [
    "name.ilike.*" + encodeURIComponent(q) + "*",
    "username.ilike.*" + encodeURIComponent(q.replace(/^@/, "")) + "*",
  ];
  if (/^[0-9a-f-]{36}$/i.test(q)) parts.push("id.eq." + encodeURIComponent(q));
  const rows = await select(
    "profiles",
    "select=id,name,username,avatar_media_id,is_verified,last_seen_at&deleted_at=is.null&is_banned=eq.false&or=(" +
      parts.join(",") + ")&order=last_seen_at.desc.nullslast&limit=20",
  );
  json(res, 200, { items: rows || [] });
}

async function adminNotificationTemplates(req, res) {
  const actor = await requireAdmin(req, "notifications");
  if (req.method === "GET") {
    const rows = await select(
      "admin_notification_templates",
      "select=id,name,title,body,audience,deep_link,enabled,created_by,updated_by,created_at,updated_at&order=updated_at.desc&limit=200",
    );
    return json(res, 200, { items: rows || [] });
  }
  const body = await readJson(req);
  const name = String(body.name || "").trim().slice(0, 100);
  const title = String(body.title || "").trim().slice(0, 80);
  const message = String(body.body || "").trim().slice(0, 500);
  const audience = ["all","user","users","verified","active","inactive"].includes(body.audience) ? body.audience : "all";
  if (!name || !title || !message) return json(res, 400, { error: "اسم القالب والعنوان والنص مطلوبة" });
  const rows = await insert("admin_notification_templates", {
    name,
    title,
    body: message,
    audience,
    deep_link: body.deep_link && typeof body.deep_link === "object" ? body.deep_link : {},
    created_by: actor.user.id,
    updated_by: actor.user.id,
    enabled: true,
    updated_at: new Date().toISOString(),
  });
  const item = rows?.[0] || null;
  await writeAudit(actor.user.id, "create_notification_template", "notification_template", item?.id || null, { name });
  json(res, 201, { item });
}

async function updateNotificationTemplate(req, res, templateId) {
  const actor = await requireAdmin(req, "notifications");
  const body = await readJson(req);
  const patch = { updated_by: actor.user.id, updated_at: new Date().toISOString() };
  if (body.name !== undefined) patch.name = String(body.name || "").trim().slice(0, 100);
  if (body.title !== undefined) patch.title = String(body.title || "").trim().slice(0, 80);
  if (body.body !== undefined) patch.body = String(body.body || "").trim().slice(0, 500);
  if (body.audience !== undefined && ["all","user","users","verified","active","inactive"].includes(body.audience)) patch.audience = body.audience;
  if (body.deep_link !== undefined && body.deep_link && typeof body.deep_link === "object") patch.deep_link = body.deep_link;
  if (body.enabled !== undefined) patch.enabled = Boolean(body.enabled);
  await update("admin_notification_templates", "id=eq." + encodeURIComponent(templateId), patch, { returning: false });
  await writeAudit(actor.user.id, "update_notification_template", "notification_template", templateId, {});
  json(res, 200, { ok: true });
}

async function deleteNotificationTemplate(req, res, templateId) {
  const actor = await requireAdmin(req, "notifications");
  await remove("admin_notification_templates", "id=eq." + encodeURIComponent(templateId));
  await writeAudit(actor.user.id, "delete_notification_template", "notification_template", templateId, {});
  json(res, 200, { ok: true });
}

async function updateScheduledAdminNotification(req, res, notificationId) {
  const actor = await requireAdmin(req, "notifications");
  const rows = await select(
    "admin_notification_history",
    "select=id,status,title,body,audience,target_user_id,target_user_ids,deep_link,scheduled_at&id=eq." +
      encodeURIComponent(notificationId) + "&limit=1",
  );
  const current = rows?.[0];
  if (!current) return json(res, 404, { error: "الإشعار غير موجود" });
  if (current.status !== "scheduled") return json(res, 409, { error: "يمكن تعديل الإشعارات المجدولة فقط" });
  const body = await readJson(req);
  const title = body.title !== undefined ? String(body.title || "").trim().slice(0,80) : current.title;
  const message = body.body !== undefined ? String(body.body || "").trim().slice(0,500) : current.body;
  const audience = body.audience !== undefined && ["all","user","users","verified","active","inactive"].includes(body.audience)
    ? body.audience : current.audience;
  const userId = audience === "user" ? String(body.user_id ?? current.target_user_id ?? "").trim() : null;
  const userIds = audience === "users"
    ? [...new Set((Array.isArray(body.user_ids) ? body.user_ids : current.target_user_ids || []).map(String).filter((id) => /^[0-9a-f-]{36}$/i.test(id)))].slice(0,500)
    : [];
  const scheduledAt = body.scheduled_at ? new Date(body.scheduled_at) : new Date(current.scheduled_at);
  if (!title || !message || Number.isNaN(scheduledAt.getTime()) || scheduledAt.getTime() <= Date.now() + 10_000) {
    return json(res, 400, { error: "تحقق من النص وموعد الجدولة المستقبلي" });
  }
  const preview = await notificationRecipients(audience, userId, userIds);
  if (!preview.count) return json(res, 400, { error: "لا يوجد مستلمون مطابقون" });
  await update("admin_notification_history", "id=eq." + encodeURIComponent(notificationId), {
    title,
    body: message,
    audience,
    target_user_id: userId,
    target_user_ids: userIds,
    deep_link: body.deep_link && typeof body.deep_link === "object" ? body.deep_link : current.deep_link,
    scheduled_at: scheduledAt.toISOString(),
    recipient_count: preview.count,
    updated_at: new Date().toISOString(),
  }, { returning: false });
  await writeAudit(actor.user.id, "update_scheduled_notification", "notification", notificationId, { recipient_count: preview.count });
  json(res, 200, { ok: true, recipient_count: preview.count });
}

async function cancelScheduledAdminNotification(req, res, notificationId) {
  const actor = await requireAdmin(req, "notifications");
  const rows = await select("admin_notification_history", "select=id,status&id=eq." + encodeURIComponent(notificationId) + "&limit=1");
  if (!rows?.[0]) return json(res, 404, { error: "الإشعار غير موجود" });
  if (rows[0].status !== "scheduled") return json(res, 409, { error: "الإشعار ليس مجدولًا" });
  await update("admin_notification_history", "id=eq." + encodeURIComponent(notificationId), {
    status: "cancelled",
    cancelled_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }, { returning: false });
  await writeAudit(actor.user.id, "cancel_notification", "notification", notificationId, {});
  json(res, 200, { ok: true });
}

async function resendAdminNotification(req, res, notificationId) {
  const actor = await requireAdmin(req, "notifications");
  const rows = await select(
    "admin_notification_history",
    "select=id,title,body,audience,target_user_id,target_user_ids,deep_link,template_id&id=eq." + encodeURIComponent(notificationId) + "&limit=1",
  );
  const original = rows?.[0];
  if (!original) return json(res, 404, { error: "الإشعار غير موجود" });
  const body = await readJson(req).catch(() => ({}));
  const scheduledAt = body.scheduled_at ? new Date(body.scheduled_at) : null;
  if (scheduledAt && Number.isNaN(scheduledAt.getTime())) return json(res, 400, { error: "موعد الإرسال غير صالح" });
  const preview = await notificationRecipients(original.audience, original.target_user_id, original.target_user_ids || []);
  const created = await insert("admin_notification_history", {
    actor_user_id: actor.user.id,
    title: original.title,
    body: original.body,
    audience: original.audience,
    target_user_id: original.target_user_id,
    target_user_ids: original.target_user_ids || [],
    deep_link: original.deep_link || {},
    template_id: original.template_id || null,
    scheduled_at: scheduledAt ? scheduledAt.toISOString() : null,
    recipient_count: preview.count,
    failure_count: 0,
    updated_at: new Date().toISOString(),
    status: scheduledAt && scheduledAt.getTime() > Date.now() + 15_000 ? "scheduled" : "pending",
  });
  const record = created?.[0];
  if (record.status === "scheduled") {
    await writeAudit(actor.user.id, "reschedule_notification", "notification", record.id, { source_id: notificationId });
    return json(res, 202, { ok: true, scheduled: true, id: record.id });
  }
  try {
    const push = await deliverAdminNotification(record);
    await writeAudit(actor.user.id, "resend_notification", "notification", record.id, { source_id: notificationId });
    json(res, 200, { ok: true, id: record.id, push });
  } catch (error) {
    await update("admin_notification_history", "id=eq." + encodeURIComponent(record.id), {
      status: "failed",
      failure_count: preview.count,
      push_result: { error: String(error.message || error).slice(0, 1000) },
      updated_at: new Date().toISOString(),
    }, { returning: false }).catch(() => {});
    await logSystemError("notifications", error, { history_id: record.id, source_id: notificationId }, actor.user.id);
    throw error;
  }
}

async function adminContent(req, res, url) {
  await requireAdmin(req, "content");
  const kind = url.searchParams.get("kind") || "posts";
  const table = ({ posts: "posts", reels: "reels", stories: "stories" })[kind];
  if (!table) return json(res, 400, { error: "نوع المحتوى غير صالح" });

  const { page, limit, offset } = pageParams(url, 24, 60);
  const status = String(url.searchParams.get("status") || "").trim();
  const authorRaw = String(url.searchParams.get("author") || url.searchParams.get("author_id") || "").trim();
  const targetId = String(url.searchParams.get("target_id") || "").trim();
  const q = String(url.searchParams.get("q") || "").trim().replace(/[,*()]/g, "");
  const visibility = String(url.searchParams.get("visibility") || "").trim();
  const comments = String(url.searchParams.get("comments") || "").trim();
  const explore = String(url.searchParams.get("explore") || "").trim();
  const reports = String(url.searchParams.get("reports") || "").trim();
  const from = String(url.searchParams.get("from") || "").trim();
  const to = String(url.searchParams.get("to") || "").trim();

  let authorId = "";
  if (authorRaw) {
    if (/^[0-9a-f-]{36}$/i.test(authorRaw)) {
      authorId = authorRaw;
    } else {
      const username = authorRaw.replace(/^@/, "").replace(/[,*()]/g, "");
      const authors = await select(
        "profiles",
        "select=id&username=ilike." + encodeURIComponent(username) + "&limit=1",
      ).catch(() => []);
      authorId = authors?.[0]?.id || "__none__";
    }
  }

  const filters = [];
  if (status) filters.push("moderation_status=eq." + encodeURIComponent(status));
  if (targetId && /^[0-9a-f-]{36}$/i.test(targetId)) filters.push("id=eq." + encodeURIComponent(targetId));
  if (authorId) filters.push("author_id=eq." + encodeURIComponent(authorId));
  if (q) filters.push("caption=ilike.*" + encodeURIComponent(q) + "*");
  if (visibility && table !== "stories") filters.push("visibility=eq." + encodeURIComponent(visibility));
  if ((comments === "true" || comments === "false") && table !== "stories") {
    filters.push("comments_enabled=eq." + comments);
  }
  if ((explore === "true" || explore === "false") && table === "reels") {
    filters.push("explore_enabled=eq." + explore);
  }
  if (from) filters.push("created_at=gte." + encodeURIComponent(new Date(from).toISOString()));
  if (to) {
    const end = new Date(to);
    end.setHours(23, 59, 59, 999);
    filters.push("created_at=lte." + encodeURIComponent(end.toISOString()));
  }

  if (reports === "true" || reports === "false") {
    const reportType = ({ posts: "post", reels: "reel", stories: "story" })[kind];
    const reportRows = await select(
      "reports",
      "select=target_id&target_type=eq." + reportType + "&limit=10000",
    ).catch(() => []);
    const ids = [...new Set((reportRows || []).map((row) => row.target_id).filter(Boolean))];
    if (reports === "true") {
      if (!ids.length) return json(res, 200, { items: [], pagination: { page, limit, total: 0, pages: 1 } });
      filters.push("id=in.(" + ids.map(encodeURIComponent).join(",") + ")");
    } else if (ids.length) {
      filters.push("id=not.in.(" + ids.map(encodeURIComponent).join(",") + ")");
    }
  }

  let fields = "id,author_id,caption,created_at,moderation_status,deleted_at,hidden_by";
  if (table === "stories") fields += ",expires_at,media_id,overlay_text,shared_type,shared_id";
  if (table === "reels") fields += ",media_id,cover_media_id,comments_enabled,explore_enabled,visibility,view_count";
  if (table === "posts") fields += ",comments_enabled,visibility,updated_at,pinned_at";

  const filterQuery = filters.join("&");
  const total = await count(table, filterQuery);
  let query = "select=" + fields;
  if (filterQuery) query += "&" + filterQuery;
  query += "&order=created_at.desc&offset=" + offset + "&limit=" + limit;

  const rows = await select(table, query);
  const items = [];
  const reportType = ({ posts: "post", reels: "reel", stories: "story" })[kind];
  for (const row of rows || []) {
    const [author, reportCount] = await Promise.all([
      select(
        "profiles",
        "select=id,name,username,avatar_media_id,is_verified&id=eq." + encodeURIComponent(row.author_id) + "&limit=1",
      ).catch(() => []),
      count("reports", "target_type=eq." + reportType + "&target_id=eq." + encodeURIComponent(row.id)).catch(() => 0),
    ]);
    let media_ids = [];
    if (kind === "posts") {
      const media = await select(
        "post_media",
        "select=media_id,sort_order&post_id=eq." + encodeURIComponent(row.id) + "&order=sort_order.asc",
      ).catch(() => []);
      media_ids = (media || []).map((m) => m.media_id);
    } else {
      if (row.media_id) media_ids.push(row.media_id);
      if (row.cover_media_id && row.cover_media_id !== row.media_id) media_ids.push(row.cover_media_id);
    }
    items.push({
      ...row,
      author: author?.[0] || null,
      media_ids,
      report_count: Number(reportCount || 0),
    });
  }

  json(res, 200, {
    items,
    pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
  });
}

async function deleteContent(req, res, kind, id) {
  const actor = await requireAdmin(req, "content");
  const table = ({ posts: "posts", reels: "reels", stories: "stories" })[kind];
  if (!table) return json(res, 400, { error: "نوع المحتوى غير صالح" });

  const fields = table === "posts"
    ? "id,author_id"
    : table === "reels"
      ? "id,author_id,media_id,cover_media_id"
      : "id,author_id,media_id";
  const rows = await select(table, "select=" + fields + "&id=eq." + encodeURIComponent(id) + "&limit=1");
  const content = rows?.[0];
  if (!content) return json(res, 404, { error: "المحتوى غير موجود" });

  let mediaIds = [];
  if (kind === "posts") {
    const media = await select(
      "post_media",
      "select=media_id&post_id=eq." + encodeURIComponent(id),
    ).catch(() => []);
    mediaIds = (media || []).map((item) => item.media_id);
  } else {
    if (content.media_id) mediaIds.push(content.media_id);
    if (content.cover_media_id && content.cover_media_id !== content.media_id) mediaIds.push(content.cover_media_id);
  }
  mediaIds = [...new Set(mediaIds.filter(Boolean))];

  await remove(table, "id=eq." + encodeURIComponent(id));

  const cleanup = [];
  for (const mediaId of mediaIds) {
    cleanup.push(await purgeMediaObject(mediaId, actor.user.id).catch((error) => ({
      media_id: mediaId,
      status: "cleanup_pending",
      error: String(error.message || error),
    })));
  }

  await writeAudit(actor.user.id, "delete_content", kind, id, {
    author_id: content.author_id,
    media_ids: mediaIds,
    cleanup,
  });
  json(res, 200, { ok: true, media_count: mediaIds.length, cleanup });
}

async function adminReports(req, res, url) {
  const actor = await requireAdmin(req, "reports");
  const { page, limit, offset } = pageParams(url, 30, 80);
  const status = String(url.searchParams.get("status") || "").trim();
  const targetType = String(url.searchParams.get("target_type") || "").trim();
  const priority = String(url.searchParams.get("priority") || "").trim();
  const assigned = String(url.searchParams.get("assigned") || "").trim();
  const q = String(url.searchParams.get("q") || "").trim().replace(/[,*()]/g, "");
  const from = String(url.searchParams.get("from") || "").trim();
  const to = String(url.searchParams.get("to") || "").trim();

  const filters = [];
  if (status) filters.push("status=eq." + encodeURIComponent(status));
  if (targetType) filters.push("target_type=eq." + encodeURIComponent(targetType));
  if (priority) filters.push("priority=eq." + encodeURIComponent(priority));
  if (assigned === "me") filters.push("assigned_to=eq." + encodeURIComponent(actor.user.id));
  else if (assigned === "unassigned") filters.push("assigned_to=is.null");
  else if (/^[0-9a-f-]{36}$/i.test(assigned)) filters.push("assigned_to=eq." + encodeURIComponent(assigned));
  if (q) filters.push("or=(reason.ilike.*" + encodeURIComponent(q) + "*,details.ilike.*" + encodeURIComponent(q) + "*,admin_note.ilike.*" + encodeURIComponent(q) + "*)");
  if (from) filters.push("created_at=gte." + encodeURIComponent(new Date(from).toISOString()));
  if (to) {
    const end = new Date(to); end.setHours(23,59,59,999);
    filters.push("created_at=lte." + encodeURIComponent(end.toISOString()));
  }

  const filterQuery = filters.join("&");
  const total = await count("reports", filterQuery);
  let query = "select=id,reporter_id,target_type,target_id,reason,details,status,priority,assigned_to,admin_note,handled_by,action_taken,review_started_at,created_at,updated_at,resolved_at";
  if (filterQuery) query += "&" + filterQuery;
  query += "&order=created_at.desc&offset=" + offset + "&limit=" + limit;
  const rows = await select("reports", query);

  const items = [];
  for (const row of rows || []) {
    const [reporter, snapshot, duplicateCount, assignee] = await Promise.all([
      select("profiles", "select=id,name,username,avatar_media_id,is_verified&id=eq." + encodeURIComponent(row.reporter_id) + "&limit=1").catch(() => []),
      reportTargetSnapshot(row.target_type, row.target_id),
      count("reports", "target_type=eq." + encodeURIComponent(row.target_type) + "&target_id=eq." + encodeURIComponent(row.target_id)).catch(() => 0),
      row.assigned_to
        ? select("profiles", "select=id,name,username,avatar_media_id&id=eq." + encodeURIComponent(row.assigned_to) + "&limit=1").catch(() => [])
        : Promise.resolve([]),
    ]);
    const targetUser = await reportTargetAuthorProfile(snapshot);
    items.push({
      ...row,
      reporter: reporter?.[0] || null,
      target: snapshot,
      target_user: targetUser,
      duplicate_count: Number(duplicateCount || 0),
      assignee: assignee?.[0] || null,
    });
  }

  json(res, 200, {
    items,
    pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
  });
}

async function adminReportDetail(req, res, reportId) {
  await requireAdmin(req, "reports");
  const rows = await select(
    "reports",
    "select=id,reporter_id,target_type,target_id,reason,details,status,priority,assigned_to,admin_note,handled_by,action_taken,review_started_at,created_at,updated_at,resolved_at&id=eq." +
      encodeURIComponent(reportId) + "&limit=1",
  );
  const report = rows?.[0];
  if (!report) return json(res, 404, { error: "البلاغ غير موجود" });

  const snapshot = await reportTargetSnapshot(report.target_type, report.target_id);
  const [reporterRows, targetUser, events, duplicateCount, assigneeRows] = await Promise.all([
    select("profiles", "select=id,name,username,avatar_media_id,is_verified,created_at&id=eq." + encodeURIComponent(report.reporter_id) + "&limit=1").catch(() => []),
    reportTargetAuthorProfile(snapshot),
    select("report_events", "select=id,actor_user_id,event_type,note,payload,created_at&report_id=eq." + encodeURIComponent(reportId) + "&order=created_at.asc&limit=500").catch(() => []),
    count("reports", "target_type=eq." + encodeURIComponent(report.target_type) + "&target_id=eq." + encodeURIComponent(report.target_id)).catch(() => 0),
    report.assigned_to
      ? select("profiles", "select=id,name,username,avatar_media_id&id=eq." + encodeURIComponent(report.assigned_to) + "&limit=1").catch(() => [])
      : Promise.resolve([]),
  ]);

  json(res, 200, {
    report,
    reporter: reporterRows?.[0] || null,
    target: snapshot,
    target_user: targetUser,
    assignee: assigneeRows?.[0] || null,
    duplicate_count: Number(duplicateCount || 0),
    events: events || [],
  });
}

async function resolveReport(req, res, reportId) {
  const actor = await requireAdmin(req, "reports");
  const rows = await select("reports", "select=id,status&id=eq." + encodeURIComponent(reportId) + "&limit=1");
  if (!rows?.[0]) return json(res, 404, { error: "البلاغ غير موجود" });
  const now = new Date().toISOString();
  await update("reports", "id=eq." + encodeURIComponent(reportId), {
    status: "resolved",
    handled_by: actor.user.id,
    resolved_at: now,
    updated_at: now,
  }, { returning: false });
  await reportEvent(reportId, actor.user.id, "resolve", "", {});
  await writeAudit(actor.user.id, "resolve_report", "report", reportId, {});
  json(res, 200, { ok: true });
}

async function addAdmin(req, res) {
  const actor = await requireAdmin(req, "admins");
  if (!["owner","secondary_admin"].includes(actor.admin.role)) {
    return json(res, 403, { error: "إضافة المشرفين متاحة للإدارة العليا فقط" });
  }
  const body = await readJson(req);
  const userId = String(body.user_id || "").trim();
  const role = String(body.role || "").trim();
  const allowed = ["secondary_admin","moderator","content_moderator","support","analyst"];
  if (!/^[0-9a-f-]{36}$/i.test(userId)) return json(res, 400, { error: "معرف المستخدم غير صالح" });
  if (!allowed.includes(role)) return json(res, 400, { error: "الدور غير صالح" });

  const profiles = await select(
    "profiles",
    "select=id,name,username,is_banned,banned_until,deleted_at&id=eq." + encodeURIComponent(userId) + "&limit=1",
  );
  const profile = profiles?.[0];
  const temporarilyBanned = Boolean(profile?.banned_until && new Date(profile.banned_until) > new Date());
  if (!profile || profile.deleted_at || profile.is_banned || temporarilyBanned) {
    return json(res, 404, { error: "الحساب غير متاح" });
  }

  const existing = await select("admins", "select=user_id,role&user_id=eq." + encodeURIComponent(userId) + "&limit=1");
  if (existing?.[0]) {
    return json(res, 409, { error: existing[0].role === "owner" ? "هذا الحساب هو مالك المنصة بالفعل" : "هذا الحساب مضاف ضمن المشرفين بالفعل" });
  }

  const permissions = role === "secondary_admin" ? {} : sanitizeAdminPermissions(body.permissions);
  const rows = await insert("admins", {
    user_id: userId,
    role,
    permissions,
    active: true,
  });

  await writeAudit(actor.user.id, "add_admin", "admin", userId, { role, permissions });
  json(res, 201, { ...(rows?.[0] || {}), profile });
}

async function adminAdmins(req, res) {
  const actor = await requireAdmin(req, "admins");
  if (!["owner","secondary_admin"].includes(actor.admin.role)) {
    return json(res, 403, { error: "إدارة المشرفين متاحة للإدارة العليا فقط" });
  }

  if (config.ownerUserId) await adminFor(config.ownerUserId).catch(() => {});
  const rows = await select(
    "admins",
    "select=user_id,role,permissions,active,last_active_at,created_at,updated_at&order=created_at.asc",
  );
  const items = [];

  for (const row of rows || []) {
    const profiles = await select(
      "profiles",
      "select=id,name,username,avatar_media_id,is_verified&id=eq." + encodeURIComponent(row.user_id) + "&limit=1",
    ).catch(() => []);
    items.push({
      ...row,
      effective_permissions: effectiveAdminPermissions(row),
      profiles: profiles?.[0] || null,
    });
  }
  json(res, 200, {
    items,
    permission_keys: ADMIN_PERMISSION_KEYS,
    role_defaults: Object.fromEntries(Object.entries(ADMIN_ROLE_PERMISSIONS).map(([role,set]) => [role,[...set]])),
  });
}

async function adminOwner(req, res) {
  const actor = await requireAdmin(req);
  if (actor.admin.role !== "owner") {
    return json(res, 403, { error: "إدارة المالك متاحة للمالك الرئيسي فقط" });
  }

  const ownerRows = await select(
    "admins",
    "select=user_id,role,active,created_at,updated_at,last_active_at&role=eq.owner&active=eq.true&limit=1",
  ).catch(() => []);
  const owner = ownerRows?.[0] || null;

  if (req.method === "GET") {
    if (!owner) return json(res, 404, { error: "لا يوجد مالك نشط" });
    const [profiles, authRecord] = await Promise.all([
      select(
        "profiles",
        "select=id,name,username,avatar_media_id,is_verified&id=eq." + encodeURIComponent(owner.user_id) + "&limit=1",
      ).catch(() => []),
      serviceRequest("/auth/v1/admin/users/" + encodeURIComponent(owner.user_id)).catch(() => null),
    ]);
    return json(res, 200, {
      owner: {
        ...owner,
        profile: profiles?.[0] || null,
        auth: authRecord ? {
          email: authRecord.email || "",
          email_confirmed_at: authRecord.email_confirmed_at || null,
          last_sign_in_at: authRecord.last_sign_in_at || null,
        } : null,
      },
      owner_only: true,
    });
  }

  const body = await readJson(req);
  const newOwnerId = String(body.new_owner_id || "").trim();
  const previousOwnerAction = String(body.previous_owner_action || "secondary_admin").trim();
  if (String(body.confirm || "") !== "TRANSFER") {
    return json(res, 400, { error: "تأكيد نقل الملكية غير صحيح" });
  }
  if (!/^[0-9a-f-]{36}$/i.test(newOwnerId)) {
    return json(res, 400, { error: "UUID الحساب الجديد غير صالح" });
  }
  if (!["secondary_admin","remove"].includes(previousOwnerAction)) {
    return json(res, 400, { error: "إجراء المالك السابق غير صالح" });
  }
  if (newOwnerId === actor.user.id) {
    return json(res, 409, { error: "هذا الحساب هو المالك الحالي بالفعل" });
  }

  const [profiles, authRecord] = await Promise.all([
    select(
      "profiles",
      "select=id,name,username,is_banned,banned_until,deleted_at&id=eq." + encodeURIComponent(newOwnerId) + "&limit=1",
    ).catch(() => []),
    serviceRequest("/auth/v1/admin/users/" + encodeURIComponent(newOwnerId)).catch(() => null),
  ]);
  const profile = profiles?.[0];
  const temporarilyBanned = Boolean(profile?.banned_until && new Date(profile.banned_until) > new Date());
  if (!authRecord || !profile || profile.deleted_at || profile.is_banned || temporarilyBanned) {
    return json(res, 404, { error: "الحساب الجديد غير موجود أو غير متاح" });
  }

  const result = await serviceRequest("/rest/v1/rpc/admin_transfer_owner", {
    method: "POST",
    body: {
      p_new_owner: newOwnerId,
      p_previous_owner_action: previousOwnerAction,
    },
  });

  await writeAudit(actor.user.id, "transfer_owner", "admin", newOwnerId, {
    old_owner_id: actor.user.id,
    previous_owner_action: previousOwnerAction,
    username: profile.username || "",
  });

  json(res, 200, {
    ok: true,
    result,
    new_owner: {
      user_id: newOwnerId,
      name: profile.name || "",
      username: profile.username || "",
      email: authRecord.email || "",
    },
    previous_owner_action: previousOwnerAction,
  });
}

async function adminAudit(req, res, url) {
  await requireAdmin(req, "admins");
  const { page, limit, offset } = pageParams(url, 40, 100);
  const action = String(url.searchParams.get("action") || "").trim().slice(0, 100);
  const targetType = String(url.searchParams.get("target_type") || "").trim().slice(0, 100);
  const role = String(url.searchParams.get("role") || "").trim().slice(0, 80);
  const actor = String(url.searchParams.get("actor") || "").trim().replace(/[,*()]/g, "").slice(0, 120);
  const q = String(url.searchParams.get("q") || "").trim().replace(/[,*()]/g, "").slice(0, 120);
  const from = String(url.searchParams.get("from") || "").trim();
  const to = String(url.searchParams.get("to") || "").trim();

  const filters = [];
  if (action) filters.push("action=eq." + encodeURIComponent(action));
  if (targetType) filters.push("target_type=eq." + encodeURIComponent(targetType));
  if (role) filters.push("actor_role=eq." + encodeURIComponent(role));
  if (actor) {
    const uuid = /^[0-9a-f-]{36}$/i.test(actor);
    const parts = [
      "actor_name.ilike.*" + encodeURIComponent(actor) + "*",
      "actor_username.ilike.*" + encodeURIComponent(actor) + "*",
    ];
    if (uuid) parts.push("actor_user_id.eq." + encodeURIComponent(actor));
    filters.push("or=(" + parts.join(",") + ")");
  }
  if (q) {
    filters.push("or=(action.ilike.*" + encodeURIComponent(q) + "*,target_type.ilike.*" + encodeURIComponent(q) + "*,target_id.ilike.*" + encodeURIComponent(q) + "*,actor_name.ilike.*" + encodeURIComponent(q) + "*,actor_username.ilike.*" + encodeURIComponent(q) + "*)");
  }
  if (from) {
    const start = new Date(from + "T00:00:00");
    if (!Number.isNaN(start.getTime())) filters.push("created_at=gte." + encodeURIComponent(start.toISOString()));
  }
  if (to) {
    const end = new Date(to + "T23:59:59.999");
    if (!Number.isNaN(end.getTime())) filters.push("created_at=lte." + encodeURIComponent(end.toISOString()));
  }

  const filterQuery = filters.join("&");
  const total = await count("audit_logs", filterQuery);
  let query = "select=id,actor_user_id,actor_telegram_id,actor_role,actor_name,actor_username,action,target_type,target_id,details,created_at";
  if (filterQuery) query += "&" + filterQuery;
  query += "&order=created_at.desc&offset=" + offset + "&limit=" + limit;
  const items = await select("audit_logs", query);

  const destructiveActions = [
    "delete_user_permanently","delete_content","delete_report_target","delete_comment",
    "remove_admin","force_logout","ban_user","deactivate_user","publish_release",
    "restore_app_settings","disable_storage_channel"
  ];
  const destructiveFilter = "action=in.(" + destructiveActions.map(encodeURIComponent).join(",") + ")";
  const dayAgo = new Date(Date.now() - 24 * 3600_000).toISOString();
  const [last24h, destructive, actorEvents] = await Promise.all([
    count("audit_logs", "created_at=gte." + encodeURIComponent(dayAgo)),
    count("audit_logs", destructiveFilter),
    count("audit_logs", "actor_user_id=not.is.null"),
  ]);

  json(res, 200, {
    items: items || [],
    pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
    summary: { total, last_24h: last24h, destructive, user_actor_events: actorEvents, append_only: true },
  });
}

async function adminChannels(req, res) {
  await requireAdmin(req, "storage");
  const items = await select(
    "storage_channels",
    "select=channel_key,channel_id,title,enabled,status,files_count,bytes_total,last_error,last_health_at,last_test_at,last_upload_at,updated_at&order=channel_key.asc",
  );
  const rows = items || [];
  json(res, 200, {
    items: rows,
    summary: {
      channels: rows.length,
      enabled: rows.filter(x => x.enabled).length,
      connected: rows.filter(x => x.enabled && x.status === "connected").length,
      errors: rows.filter(x => x.enabled && x.status === "error").length,
      files: rows.reduce((n,x) => n + Number(x.files_count || 0), 0),
      bytes: rows.reduce((n,x) => n + Number(x.bytes_total || 0), 0),
    },
  });
}

async function appSettings(req, res) {
  const actor = await requireAdmin(req, "settings");
  if (req.method === "GET") {
    const settings = await currentAppSettingsSnapshot();
    return json(res, 200, settings);
  }

  const body = await readJson(req);
  const current = await currentAppSettingsSnapshot();
  const next = { ...current };

  if (body.version !== undefined) {
    const source = body.version && typeof body.version === "object" ? body.version : {};
    const latest = String(source.latest ?? current.version?.latest ?? "").trim().slice(0, 40);
    const minimum = String(source.minimum ?? current.version?.minimum ?? "").trim().slice(0, 40);
    const downloadUrl = String(source.download_url ?? current.version?.download_url ?? "").trim().slice(0, 800);
    const sha256 = String(source.sha256 ?? current.version?.sha256 ?? "").trim().toLowerCase().slice(0, 64);
    if (latest && !validReleaseVersion(latest)) return json(res, 400, { error: "آخر إصدار غير صالح" });
    if (minimum && !validReleaseVersion(minimum)) return json(res, 400, { error: "أقل إصدار غير صالح" });
    if (!validHttpUrl(downloadUrl)) return json(res, 400, { error: "رابط التحديث غير صالح" });
    if (sha256 && !validSha256(sha256)) return json(res, 400, { error: "SHA-256 يجب أن يكون 64 خانة" });
    next.version = {
      ...(current.version || {}),
      latest,
      minimum,
      download_url: downloadUrl,
      sha256,
      message: String(source.message ?? current.version?.message ?? "").trim().slice(0, 1000),
      required: Boolean(source.required),
      version_code: Math.max(0, Number(source.version_code ?? current.version?.version_code ?? 0) || 0),
    };
  }

  if (body.maintenance !== undefined) {
    const source = body.maintenance && typeof body.maintenance === "object" ? body.maintenance : {};
    const startAt = source.start_at ? new Date(source.start_at) : null;
    const endAt = source.end_at ? new Date(source.end_at) : null;
    if (startAt && Number.isNaN(startAt.getTime())) return json(res, 400, { error: "وقت بدء الصيانة غير صالح" });
    if (endAt && Number.isNaN(endAt.getTime())) return json(res, 400, { error: "وقت انتهاء الصيانة غير صالح" });
    if (startAt && endAt && endAt <= startAt) return json(res, 400, { error: "وقت انتهاء الصيانة يجب أن يكون بعد البداية" });
    next.maintenance = {
      ...(current.maintenance || {}),
      enabled: Boolean(source.enabled),
      title: String(source.title ?? current.maintenance?.title ?? "آشور").trim().slice(0, 120),
      message: String(source.message ?? current.maintenance?.message ?? "").trim().slice(0, 1000),
      start_at: startAt ? startAt.toISOString() : null,
      end_at: endAt ? endAt.toISOString() : null,
    };
  }

  if (body.features !== undefined) {
    const source = body.features && typeof body.features === "object" ? body.features : {};
    const allowed = ["stories","reels","messages","groups","registration","comments","search","explore","saved","notifications","uploads"];
    const features = { ...(current.features || {}) };
    for (const key of allowed) {
      if (source[key] !== undefined) features[key] = Boolean(source[key]);
    }
    next.features = features;
  }

  if (body.limits !== undefined) {
    const source = body.limits && typeof body.limits === "object" ? body.limits : {};
    const clamp = (value, fallback, max = 60) => Math.max(1, Math.min(max, Math.floor(Number(value ?? fallback) || fallback)));
    next.limits = {
      ...(current.limits || {}),
      max_upload_mb: clamp(source.max_upload_mb, current.limits?.max_upload_mb || 60),
      story_mb: clamp(source.story_mb, current.limits?.story_mb || 30),
      reel_mb: clamp(source.reel_mb, current.limits?.reel_mb || current.limits?.max_upload_mb || 60),
      image_mb: clamp(source.image_mb, current.limits?.image_mb || 10),
      chat_video_mb: clamp(source.chat_video_mb, current.limits?.chat_video_mb || 50),
      audio_mb: clamp(source.audio_mb, current.limits?.audio_mb || 15),
    };
  }

  await saveAppSettingsSnapshot(actor.user.id, "admin_update", String(body.reason || "تعديل إعدادات التطبيق").slice(0, 500));
  const changedKeys = [];
  for (const key of ["version", "maintenance", "limits", "features"]) {
    if (body[key] === undefined) continue;
    await upsert("app_settings", {
      key,
      value: next[key] || {},
      public_read: true,
      updated_at: new Date().toISOString(),
    }, "key");
    changedKeys.push(key);
  }
  await writeAudit(actor.user.id, "update_app_settings", "app_settings", null, { keys: changedKeys });
  json(res, 200, { ok: true, settings: next });
}

async function appSettingsHistory(req, res) {
  await requireAdmin(req, "settings");
  const rows = await select(
    "app_settings_history",
    "select=id,actor_user_id,source,reason,snapshot,created_at&order=created_at.desc&limit=60",
  );
  json(res, 200, { items: rows || [] });
}

async function restoreAppSettings(req, res, historyId) {
  const actor = await requireAdmin(req, "settings");
  const rows = await select(
    "app_settings_history",
    "select=id,source,reason,snapshot,created_at&id=eq." + encodeURIComponent(historyId) + "&limit=1",
  );
  const history = rows?.[0];
  if (!history?.snapshot || typeof history.snapshot !== "object") {
    return json(res, 404, { error: "نسخة الإعدادات غير موجودة" });
  }

  await saveAppSettingsSnapshot(actor.user.id, "before_restore", "نسخة تلقائية قبل الاستعادة");
  const restoredKeys = [];
  for (const key of ["version","maintenance","limits","features"]) {
    if (history.snapshot[key] === undefined) continue;
    await upsert("app_settings", {
      key,
      value: history.snapshot[key],
      public_read: true,
      updated_at: new Date().toISOString(),
    }, "key");
    restoredKeys.push(key);
  }
  await writeAudit(actor.user.id, "restore_app_settings", "app_settings_history", historyId, {
    source: history.source,
    created_at: history.created_at,
    keys: restoredKeys,
  });
  json(res, 200, { ok: true, restored_keys: restoredKeys });
}

async function siteSettings(req, res) {
  const actor = await requireAdmin(req, "settings");
  const allowedKeys = ["hero", "download", "features", "update", "support", "legal"];
  if (req.method === "GET") {
    const rows = await select("site_settings", "select=key,value,updated_at&order=key.asc");
    return json(res, 200, {
      ...Object.fromEntries((rows || []).map((x) => [x.key, x.value])),
      _meta: Object.fromEntries((rows || []).map((x) => [x.key, { updated_at: x.updated_at }])),
    });
  }

  const body = await readJson(req);
  const next = {};

  if (body.hero !== undefined) {
    const source = body.hero && typeof body.hero === "object" ? body.hero : {};
    next.hero = {
      title: String(source.title || "آشور").trim().slice(0, 80),
      subtitle: String(source.subtitle || "").trim().slice(0, 240),
    };
  }

  if (body.download !== undefined) {
    const source = body.download && typeof body.download === "object" ? body.download : {};
    const androidUrl = String(source.android_url || "").trim().slice(0, 800);
    const webUrl = String(source.web_url || "").trim().slice(0, 800);
    if (!validHttpUrl(androidUrl) || !validHttpUrl(webUrl)) return json(res, 400, { error: "أحد روابط الموقع غير صالح" });
    const sha256 = String(source.sha256 || "").trim().toLowerCase().slice(0, 64);
    if (sha256 && !validSha256(sha256)) return json(res, 400, { error: "SHA-256 يجب أن يكون 64 خانة" });
    next.download = {
      android_url: androidUrl,
      download_url: androidUrl,
      web_url: webUrl,
      version: String(source.version || "").trim().slice(0, 40),
      size: String(source.size || "").trim().slice(0, 40),
      sha256,
      updated_at: new Date().toISOString(),
    };
  }

  if (body.features !== undefined) {
    const source = body.features && typeof body.features === "object" ? body.features : {};
    const items = Array.isArray(source.items) ? source.items.slice(0, 8) : [];
    next.features = {
      items: items.map((item) => ({
        title: String(item?.title || "").trim().slice(0, 80),
        description: String(item?.description || "").trim().slice(0, 240),
        enabled: item?.enabled !== false,
      })).filter((item) => item.title),
    };
  }

  if (body.update !== undefined) {
    const source = body.update && typeof body.update === "object" ? body.update : {};
    next.update = {
      label: String(source.label || "آخر تحديث").trim().slice(0, 80),
      text: String(source.text || "").trim().slice(0, 500),
    };
  }

  if (body.support !== undefined) {
    const source = body.support && typeof body.support === "object" ? body.support : {};
    const supportUrl = String(source.url || "").trim().slice(0, 800);
    if (!validHttpUrl(supportUrl)) return json(res, 400, { error: "رابط الدعم غير صالح" });
    const email = String(source.email || "").trim().slice(0, 160);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(res, 400, { error: "بريد الدعم غير صالح" });
    next.support = {
      url: supportUrl,
      email,
      label: String(source.label || "الدعم والمساعدة").trim().slice(0, 80),
    };
  }

  if (body.legal !== undefined) {
    const source = body.legal && typeof body.legal === "object" ? body.legal : {};
    const privacyUrl = String(source.privacy_url || "").trim().slice(0, 800);
    const termsUrl = String(source.terms_url || "").trim().slice(0, 800);
    if (!validHttpUrl(privacyUrl) || !validHttpUrl(termsUrl)) return json(res, 400, { error: "أحد روابط السياسة أو الشروط غير صالح" });
    next.legal = { privacy_url: privacyUrl, terms_url: termsUrl };
  }

  const changed = [];
  for (const key of allowedKeys) {
    if (next[key] === undefined) continue;
    await upsert("site_settings", { key, value: next[key], updated_at: new Date().toISOString() }, "key");
    changed.push(key);
  }
  await writeAudit(actor.user.id, "update_site_settings", "site_settings", null, { keys: changed });
  json(res, 200, { ok: true, keys: changed });
}

async function notificationRecipients(audience, targetUserId = null, targetUserIds = []) {
  if (audience === "user") {
    return targetUserId ? { ids: [targetUserId], all: false, count: 1 } : { ids: [], all: false, count: 0 };
  }
  if (audience === "users") {
    const ids = [...new Set((Array.isArray(targetUserIds) ? targetUserIds : []).filter((id) => /^[0-9a-f-]{36}$/i.test(String(id))))];
    return { ids, all: false, count: ids.length };
  }
  let filter = "is_banned=eq.false&deleted_at=is.null";
  if (audience === "verified") filter += "&is_verified=eq.true";
  if (audience === "active") {
    const since = new Date(Date.now() - 30 * 24 * 3600_000).toISOString();
    filter += "&last_seen_at=gte." + encodeURIComponent(since);
  }
  if (audience === "inactive") {
    const before = new Date(Date.now() - 30 * 24 * 3600_000).toISOString();
    filter += "&or=(last_seen_at.is.null,last_seen_at.lt." + encodeURIComponent(before) + ")";
  }
  const [users, total] = await Promise.all([
    select("profiles", "select=id&" + filter + "&limit=10000"),
    count("profiles", filter),
  ]);
  return { ids: (users || []).map((x) => x.id), all: audience === "all", count: Number(total || 0) };
}

async function deliverAdminNotification(record) {
  const audience = record.audience || "all";
  const targetUserId = record.target_user_id || null;
  const targetUserIds = Array.isArray(record.target_user_ids) ? record.target_user_ids : [];
  const recipients = await notificationRecipients(audience, targetUserId, targetUserIds);
  if (!recipients.count) throw new Error("لا يوجد مستلمون مطابقون لهذا الاستهداف");
  const data = {
    kind: "system",
    ...(record.deep_link || {}),
    notification_history_id: record.id,
  };

  const inAppRows = recipients.ids.map((userId) => ({
    user_id: userId,
    actor_id: record.actor_user_id || null,
    kind: "system",
    title: record.title,
    body: record.body,
    entity_type: record.deep_link?.entity_type || null,
    entity_id: record.deep_link?.entity_id || null,
  }));
  if (inAppRows.length) {
    await insert("notifications", inAppRows, { returning: false });
  }

  const push = await sendPush({
    ...(recipients.all ? { all: true } : { userIds: recipients.ids }),
    title: record.title,
    body: record.body,
    data,
    idempotencyKey: record.id,
  });
  if (push?.skipped || push?.ok === false) {
    throw new Error(push?.reason || push?.errors || "تعذر إرسال الإشعار");
  }

  await update("admin_notification_history", "id=eq." + encodeURIComponent(record.id), {
    status: "sent",
    sent_at: new Date().toISOString(),
    recipient_count: recipients.count,
    failure_count: 0,
    push_result: push || {},
    updated_at: new Date().toISOString(),
  }, { returning: false });
  return { ...push, recipient_count: recipients.count };
}

async function sendAdminNotification(req, res) {
  const actor = await requireAdmin(req, "notifications");
  const body = await readJson(req);
  const title = String(body.title || "").trim().slice(0, 80);
  const message = String(body.body || "").trim().slice(0, 500);
  const audience = ["all", "user", "users", "verified", "active", "inactive"].includes(body.audience)
    ? body.audience
    : "all";
  const userId = audience === "user" ? String(body.user_id || "").trim() : null;
  const userIds = audience === "users"
    ? [...new Set((Array.isArray(body.user_ids) ? body.user_ids : []).map(String).filter((id) => /^[0-9a-f-]{36}$/i.test(id)))].slice(0, 500)
    : [];
  const deepLink = body.deep_link && typeof body.deep_link === "object" ? body.deep_link : {};
  const scheduledAt = body.scheduled_at ? new Date(body.scheduled_at) : null;
  const templateId = /^[0-9a-f-]{36}$/i.test(String(body.template_id || "")) ? String(body.template_id) : null;
  if (!title || !message) return json(res, 400, { error: "العنوان والنص مطلوبان" });
  if (audience === "user" && !/^[0-9a-f-]{36}$/i.test(userId || "")) {
    return json(res, 400, { error: "معرف المستخدم مطلوب" });
  }
  if (audience === "users" && !userIds.length) {
    return json(res, 400, { error: "اختر مستخدمًا واحدًا على الأقل" });
  }
  if (scheduledAt && Number.isNaN(scheduledAt.getTime())) {
    return json(res, 400, { error: "موعد الإرسال غير صالح" });
  }

  const preview = await notificationRecipients(audience, userId, userIds);
  if (!preview.count) return json(res, 400, { error: "لا يوجد مستلمون مطابقون لهذا الاستهداف" });

  const rows = await insert("admin_notification_history", {
    actor_user_id: actor.user.id,
    title,
    body: message,
    audience,
    target_user_id: userId,
    target_user_ids: userIds,
    deep_link: deepLink,
    scheduled_at: scheduledAt ? scheduledAt.toISOString() : null,
    recipient_count: preview.count,
    failure_count: 0,
    template_id: templateId,
    updated_at: new Date().toISOString(),
    status: scheduledAt && scheduledAt.getTime() > Date.now() + 15_000 ? "scheduled" : "pending",
  });
  const record = rows?.[0];

  if (record.status === "scheduled") {
    await writeAudit(actor.user.id, "schedule_notification", "notification", record.id, {
      audience, scheduled_at: record.scheduled_at, recipient_count: preview.count,
    });
    return json(res, 202, { ok: true, scheduled: true, id: record.id, recipient_count: preview.count });
  }

  try {
    const push = await deliverAdminNotification(record);
    await writeAudit(actor.user.id, "send_notification", "notification", record.id, {
      audience, recipient_count: preview.count,
    });
    return json(res, 200, { ok: true, push, id: record.id, recipient_count: preview.count });
  } catch (error) {
    await update("admin_notification_history", "id=eq." + encodeURIComponent(record.id), {
      status: "failed",
      failure_count: preview.count,
      push_result: { error: String(error.message || error).slice(0, 1000) },
      updated_at: new Date().toISOString(),
    }, { returning: false }).catch(() => {});
    await logSystemError("notifications", error, { history_id: record.id }, actor.user.id);
    throw error;
  }
}

async function processScheduledAdminNotifications() {
  if (!readiness().database) return;
  const now = new Date().toISOString();
  const rows = await select(
    "admin_notification_history",
    "select=id,actor_user_id,title,body,audience,target_user_id,target_user_ids,deep_link,scheduled_at,status,recipient_count&status=eq.scheduled&scheduled_at=lte." +
      encodeURIComponent(now) + "&order=scheduled_at.asc&limit=20",
  ).catch(() => []);
  for (const record of rows || []) {
    await update("admin_notification_history", "id=eq." + encodeURIComponent(record.id), {
      status: "processing",
      updated_at: new Date().toISOString(),
    }, { returning: false }).catch(() => {});
    try {
      await deliverAdminNotification(record);
    } catch (error) {
      await update("admin_notification_history", "id=eq." + encodeURIComponent(record.id), {
        status: "failed",
        failure_count: Math.max(1, Number(record.recipient_count || 0)),
        push_result: { error: String(error.message || error).slice(0, 1000) },
        updated_at: new Date().toISOString(),
      }, { returning: false }).catch(() => {});
      await logSystemError("notifications", error, { history_id: record.id }, record.actor_user_id);
    }
  }
}

async function collectHealthDetails(includeInternal = false) {
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
  const result = {
    status: ready.database ? "running" : "setup_required",
    checked_at: new Date().toISOString(),
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
  };

  if (includeInternal && ready.database) {
    const [queuedUploads, activeUploads, failedUploads, cleanupPending, cleanupFailed, notificationOutbox,
      scheduledNotifications, failedNotifications, openErrors, connectedChannels] = await Promise.all([
      count("upload_jobs", "status=eq.queued"),
      count("upload_jobs", "status=in.(receiving,storing)"),
      count("upload_jobs", "status=eq.failed&retry_available=eq.true"),
      count("media_cleanup_jobs", "status=in.(pending,processing)"),
      count("media_cleanup_jobs", "status=eq.failed"),
      count("notification_outbox", "processed_at=is.null&attempts=lt.5"),
      count("admin_notification_history", "status=eq.scheduled"),
      count("admin_notification_history", "status=eq.failed"),
      count("system_errors", "status=neq.resolved"),
      count("storage_channels", "enabled=eq.true&status=eq.connected"),
    ]);
    const memory = process.memoryUsage();
    result.runtime = {
      api_version: "1.3.1",
        gateway_revision: "G1",
      admin_revision: "A14",
      commit: process.env.RAILWAY_GIT_COMMIT_SHA || process.env.GIT_COMMIT_SHA || "",
      uptime_seconds: Math.floor(process.uptime()),
      memory_mb: {
        rss: Math.round(memory.rss / 1024 / 1024),
        heap_used: Math.round(memory.heapUsed / 1024 / 1024),
      },
    };
    result.queues = {
      uploads_queued: queuedUploads,
      uploads_active: activeUploads,
      uploads_failed: failedUploads,
      cleanup_pending: cleanupPending,
      cleanup_failed: cleanupFailed,
      notification_outbox: notificationOutbox,
      notifications_scheduled: scheduledNotifications,
      notifications_failed: failedNotifications,
      errors_open: openErrors,
      storage_connected: connectedChannels,
    };
  }
  return result;
}

async function healthDetails(res) {
  json(res, 200, await collectHealthDetails(false));
}

async function adminSystemHealth(req, res) {
  await requireAdmin(req, "analytics");
  json(res, 200, await collectHealthDetails(true));
}

async function adminClientError(req, res) {
  const actor = await requireAdmin(req);
  const body = await readJson(req, 32 * 1024).catch(() => ({}));
  const error = new Error(String(body.message || "Admin UI error").slice(0, 1000));
  error.code = "ADMIN_UI";
  error.statusCode = 500;
  await logSystemError("admin-web", error, {
    stage: String(body.stage || "admin-ui").slice(0, 80),
    page: String(body.page || "").slice(0, 80),
    admin_version: String(body.admin_version || "").slice(0, 40)
  }, actor.user.id);
  json(res, 201, { ok: true });
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

async function handleHttpRequest(req, res) {
  cors(res);
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    return res.end();
  }

  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  try {
    if (req.method === "GET" && url.pathname === "/health") {
      return json(res, 200, {
        ok: true,
        api_version: "1.3.0",
        messaging_revision: "E2",
        stories_revision: "S3",
        content_revision: "C3",
        admin_revision: "A14",
        commit: process.env.RAILWAY_GIT_COMMIT_SHA || process.env.GIT_COMMIT_SHA || "",
        readiness: readiness()
      });
    }
    if (req.method === "GET" && url.pathname === "/health/details") {
      return healthDetails(res);
    }

    if (req.method === "POST" && url.pathname === "/v1/storage/upload") {
      return handleUpload(req, res, url);
    }


    const cancelUploadMatch = /^\/v1\/uploads\/([^/]+)\/cancel$/.exec(url.pathname);
    if (req.method === "POST" && cancelUploadMatch) {
      return cancelUploadJob(req, res, decodeURIComponent(cancelUploadMatch[1]));
    }

    const blockMatch = /^\/v1\/social\/block\/([0-9a-f-]{36})$/.exec(url.pathname);
    if (req.method === "POST" && blockMatch) {
      return socialBlock(req, res, blockMatch[1]);
    }
    if (req.method === "GET" && url.pathname === "/v1/social/blocked") {
      return socialBlockedList(req, res);
    }
    if (req.method === "POST" && url.pathname === "/v1/social/report") {
      return socialReport(req, res);
    }
    if (url.pathname === "/v1/social/support") {
      if (req.method === "GET") return socialSupportList(req, res);
      if (req.method === "POST") return socialSupport(req, res);
    }
    const socialSupportDetailMatch = /^\/v1\/social\/support\/([0-9a-f-]{36})$/.exec(url.pathname);
    if (socialSupportDetailMatch && req.method === "GET") {
      return socialSupportDetail(req, res, socialSupportDetailMatch[1]);
    }
    if (socialSupportDetailMatch && req.method === "POST") {
      return socialSupportReply(req, res, socialSupportDetailMatch[1]);
    }
    if (req.method === "POST" && url.pathname === "/v1/social/save") {
      return socialSave(req, res);
    }
    if (req.method === "GET" && url.pathname === "/v1/social/saved") {
      return socialSaved(req, res, url);
    }
    const storyViewMatch = /^\/v1\/social\/story-view\/([0-9a-f-]{36})$/.exec(url.pathname);
    if (req.method === "POST" && storyViewMatch) {
      return socialStoryView(req, res, storyViewMatch[1]);
    }
    const storyViewersMatch = /^\/v1\/social\/story-viewers\/([0-9a-f-]{36})$/.exec(url.pathname);
    if (req.method === "GET" && storyViewersMatch) {
      return socialStoryViewers(req, res, storyViewersMatch[1]);
    }
    const followListMatch = /^\/v1\/social\/follows\/([0-9a-f-]{36})$/.exec(url.pathname);
    if (req.method === "GET" && followListMatch) {
      return socialFollowList(req, res, followListMatch[1], url);
    }
    if (req.method === "POST" && url.pathname === "/v1/social/message-read") {
      return socialMessageRead(req, res);
    }
    if (req.method === "POST" && url.pathname === "/v1/social/share-story") {
      return socialShareToStory(req, res);
    }
    if (req.method === "POST" && url.pathname === "/v1/social/mentions") {
      return socialMentions(req, res);
    }
    if (req.method === "POST" && url.pathname === "/v1/social/reshare-mentioned-story") {
      return socialReshareMentionedStory(req, res);
    }
    const publicSavedMatch = /^\/v1\/social\/saved\/([0-9a-f-]{36})$/.exec(url.pathname);
    if (req.method === "GET" && publicSavedMatch) {
      return socialPublicSaved(req, res, publicSavedMatch[1], url);
    }
    const reelViewMatch = /^\/v1\/social\/reel-view\/([0-9a-f-]{36})$/.exec(url.pathname);
    if (req.method === "POST" && reelViewMatch) {
      return socialRecordReelView(req, res, reelViewMatch[1]);
    }
    const commentPinMatch = /^\/v1\/social\/comments\/([0-9a-f-]{36})\/pin$/.exec(url.pathname);
    if (req.method === "PATCH" && commentPinMatch) {
      return socialPinComment(req, res, commentPinMatch[1]);
    }
    const socialContentMatch = /^\/v1\/social\/content\/(posts|reels|stories)\/([0-9a-f-]{36})$/.exec(url.pathname);
    if (socialContentMatch && req.method === "PATCH") {
      return socialEditContent(req, res, socialContentMatch[1], socialContentMatch[2]);
    }
    if (socialContentMatch && req.method === "DELETE") {
      return socialDeleteContent(req, res, socialContentMatch[1], socialContentMatch[2]);
    }
    const socialCommentMatch = /^\/v1\/social\/comments\/([0-9a-f-]{36})$/.exec(url.pathname);
    if (socialCommentMatch && ["PATCH", "DELETE"].includes(req.method)) {
      return socialEditComment(req, res, socialCommentMatch[1]);
    }
    if (req.method === "DELETE" && url.pathname === "/v1/account") {
      return socialDeleteAccount(req, res);
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
    const conversationDetailsMatch = /^\/v1\/conversations\/([0-9a-f-]{36})$/.exec(url.pathname);
    if (conversationDetailsMatch && req.method === "GET") {
      return conversationDetails(req, res, conversationDetailsMatch[1]);
    }
    if (conversationDetailsMatch && req.method === "PATCH") {
      return updateConversationSettings(req, res, conversationDetailsMatch[1]);
    }
    const conversationMembersMatch = /^\/v1\/conversations\/([0-9a-f-]{36})\/members$/.exec(url.pathname);
    if (conversationMembersMatch && req.method === "POST") {
      return addConversationMember(req, res, conversationMembersMatch[1]);
    }
    const conversationMemberMatch = /^\/v1\/conversations\/([0-9a-f-]{36})\/members\/([0-9a-f-]{36})$/.exec(url.pathname);
    if (conversationMemberMatch && req.method === "PATCH") {
      return updateConversationMember(req, res, conversationMemberMatch[1], conversationMemberMatch[2]);
    }
    if (conversationMemberMatch && req.method === "DELETE") {
      return removeConversationMember(req, res, conversationMemberMatch[1], conversationMemberMatch[2]);
    }
    const conversationMessageMatch = /^\/v1\/conversations\/([0-9a-f-]{36})\/messages$/.exec(url.pathname);
    if (req.method === "GET" && conversationMessageMatch) {
      return listConversationMessages(req, res, conversationMessageMatch[1]);
    }
    if (req.method === "POST" && conversationMessageMatch) {
      return sendConversationMessage(req, res, conversationMessageMatch[1]);
    }

    if (req.method === "POST" && url.pathname === "/v1/admin/client-error") {
      return adminClientError(req, res);
    }

    if (req.method === "GET" && url.pathname === "/v1/admin/me") {
      const result = await requireAdmin(req);
      return json(res, 200, {
        id: result.user.id,
        role: result.admin.role,
        permissions: result.admin.permissions || {},
        effective_permissions: effectiveAdminPermissions(result.admin),
        permission_keys: ADMIN_PERMISSION_KEYS,
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

    const adminUserDetailMatch = /^\/v1\/admin\/users\/([0-9a-f-]{36})$/.exec(url.pathname);
    if (req.method === "GET" && adminUserDetailMatch) {
      return adminUserDetail(req, res, adminUserDetailMatch[1]);
    }
    if (req.method === "DELETE" && adminUserDetailMatch) {
      return adminDeleteUser(req, res, adminUserDetailMatch[1]);
    }
    const adminUserActionMatch = /^\/v1\/admin\/users\/([0-9a-f-]{36})\/action$/.exec(url.pathname);
    if (req.method === "POST" && adminUserActionMatch) {
      return adminUserAction(req, res, adminUserActionMatch[1]);
    }
    if (req.method === "GET" && url.pathname === "/v1/admin/comments") {
      return adminComments(req, res, url);
    }

    if (req.method === "GET" && url.pathname === "/v1/admin/content") {
      return adminContent(req, res, url);
    }
    const moderateMatch = /^\/v1\/admin\/content\/(posts|reels|stories|comments)\/([0-9a-f-]{36})\/moderate$/.exec(url.pathname);
    if (req.method === "POST" && moderateMatch) {
      return moderateContent(req, res, moderateMatch[1], moderateMatch[2]);
    }

    const contentMatch = /^\/v1\/admin\/content\/(posts|reels|stories)\/([0-9a-f-]{36})$/.exec(url.pathname);
    if (req.method === "DELETE" && contentMatch) {
      return deleteContent(req, res, contentMatch[1], contentMatch[2]);
    }

    if (req.method === "GET" && url.pathname === "/v1/admin/reports") {
      return adminReports(req, res, url);
    }
    const adminReportDetailMatch = /^\/v1\/admin\/reports\/([0-9a-f-]{36})$/.exec(url.pathname);
    if (req.method === "GET" && adminReportDetailMatch) {
      return adminReportDetail(req, res, adminReportDetailMatch[1]);
    }
    const reportActionMatch = /^\/v1\/admin\/reports\/([0-9a-f-]{36})\/action$/.exec(url.pathname);
    if (req.method === "POST" && reportActionMatch) {
      return reportAction(req, res, reportActionMatch[1]);
    }

    const reportMatch = /^\/v1\/admin\/reports\/([0-9a-f-]{36})\/resolve$/.exec(url.pathname);
    if (req.method === "POST" && reportMatch) {
      return resolveReport(req, res, reportMatch[1]);
    }

    if (req.method === "GET" && url.pathname === "/v1/admin/channels") {
      return adminChannels(req, res);
    }
    if (req.method === "POST" && url.pathname === "/v1/admin/channels/test-all") {
      return adminTestAllChannels(req, res);
    }
    const channelTestMatch = /^\/v1\/admin\/channels\/([^/]+)\/test$/.exec(url.pathname);
    if (req.method === "POST" && channelTestMatch) {
      return testAdminChannel(req, res, decodeURIComponent(channelTestMatch[1]));
    }
    const channelActionMatch = /^\/v1\/admin\/channels\/([^/]+)\/action$/.exec(url.pathname);
    if (req.method === "POST" && channelActionMatch) {
      return adminChannelAction(req, res, decodeURIComponent(channelActionMatch[1]));
    }
    if (req.method === "GET" && url.pathname === "/v1/admin/uploads") {
      return adminUploads(req, res, url);
    }
    const adminUploadCancelMatch = /^\/v1\/admin\/uploads\/([0-9a-f-]{36})\/cancel$/.exec(url.pathname);
    if (req.method === "POST" && adminUploadCancelMatch) {
      return adminCancelUpload(req, res, adminUploadCancelMatch[1]);
    }
    const adminUploadRetryMatch = /^\/v1\/admin\/uploads\/([0-9a-f-]{36})\/retry$/.exec(url.pathname);
    if (req.method === "POST" && adminUploadRetryMatch) {
      return adminRetryUpload(req, res, adminUploadRetryMatch[1]);
    }
    if (req.method === "GET" && url.pathname === "/v1/admin/errors") {
      return adminErrors(req, res, url);
    }
    if (req.method === "GET" && url.pathname === "/v1/admin/system/health") {
      return adminSystemHealth(req, res);
    }
    const errorResolveMatch = /^\/v1\/admin\/errors\/(\d+)\/resolve$/.exec(url.pathname);
    if (req.method === "POST" && errorResolveMatch) {
      return resolveSystemError(req, res, errorResolveMatch[1]);
    }
    const errorReopenMatch = /^\/v1\/admin\/errors\/(\d+)\/reopen$/.exec(url.pathname);
    if (req.method === "POST" && errorReopenMatch) {
      return reopenSystemError(req, res, errorReopenMatch[1]);
    }
    if (req.method === "GET" && url.pathname === "/v1/admin/support") {
      return adminSupport(req, res, url);
    }
    const adminSupportDetailMatch = /^\/v1\/admin\/support\/([0-9a-f-]{36})$/.exec(url.pathname);
    if (req.method === "GET" && adminSupportDetailMatch) {
      return adminSupportDetail(req, res, adminSupportDetailMatch[1]);
    }
    const supportReplyMatch = /^\/v1\/admin\/support\/([0-9a-f-]{36})\/reply$/.exec(url.pathname);
    if (req.method === "POST" && supportReplyMatch) {
      return replySupport(req, res, supportReplyMatch[1]);
    }
    if (url.pathname === "/v1/admin/releases" && ["GET", "POST"].includes(req.method)) {
      return adminReleases(req, res);
    }
    const releaseMatch = /^\/v1\/admin\/releases\/([0-9a-f-]{36})$/.exec(url.pathname);
    if (req.method === "PATCH" && releaseMatch) {
      return updateRelease(req, res, releaseMatch[1]);
    }
    if (req.method === "GET" && url.pathname === "/v1/admin/notifications/history") {
      return adminNotificationHistory(req, res, url);
    }
    if (req.method === "GET" && url.pathname === "/v1/admin/notifications/preview") {
      return adminNotificationPreview(req, res, url);
    }
    if (req.method === "GET" && url.pathname === "/v1/admin/notifications/users") {
      return adminNotificationUsers(req, res, url);
    }
    if (url.pathname === "/v1/admin/notification-templates" && ["GET", "POST"].includes(req.method)) {
      return adminNotificationTemplates(req, res);
    }
    const notificationTemplateMatch = /^\/v1\/admin\/notification-templates\/([0-9a-f-]{36})$/.exec(url.pathname);
    if (notificationTemplateMatch && req.method === "PATCH") {
      return updateNotificationTemplate(req, res, notificationTemplateMatch[1]);
    }
    if (notificationTemplateMatch && req.method === "DELETE") {
      return deleteNotificationTemplate(req, res, notificationTemplateMatch[1]);
    }
    const scheduledNotificationMatch = /^\/v1\/admin\/notifications\/([0-9a-f-]{36})$/.exec(url.pathname);
    if (scheduledNotificationMatch && req.method === "PATCH") {
      return updateScheduledAdminNotification(req, res, scheduledNotificationMatch[1]);
    }
    const cancelNotificationMatch = /^\/v1\/admin\/notifications\/([0-9a-f-]{36})\/cancel$/.exec(url.pathname);
    if (cancelNotificationMatch && req.method === "POST") {
      return cancelScheduledAdminNotification(req, res, cancelNotificationMatch[1]);
    }
    const resendNotificationMatch = /^\/v1\/admin\/notifications\/([0-9a-f-]{36})\/resend$/.exec(url.pathname);
    if (resendNotificationMatch && req.method === "POST") {
      return resendAdminNotification(req, res, resendNotificationMatch[1]);
    }


    if (url.pathname === "/v1/admin/owner" && ["GET","POST"].includes(req.method)) {
      return adminOwner(req, res);
    }
    if (url.pathname === "/v1/admin/admins") {
      if (req.method === "GET") return adminAdmins(req, res);
      if (req.method === "POST") return addAdmin(req, res);
    }
    if (req.method === "GET" && url.pathname === "/v1/admin/admin-candidates") {
      return adminCandidates(req, res, url);
    }
    const adminRecordMatch = /^\/v1\/admin\/admins\/([0-9a-f-]{36})$/.exec(url.pathname);
    if (req.method === "PATCH" && adminRecordMatch) {
      return updateAdminRecord(req, res, adminRecordMatch[1]);
    }
    if (req.method === "DELETE" && adminRecordMatch) {
      return removeAdminRecord(req, res, adminRecordMatch[1]);
    }
    if (req.method === "GET" && url.pathname === "/v1/admin/audit") {
      return adminAudit(req, res, url);
    }
    if (url.pathname === "/v1/admin/settings/app" && ["GET", "PUT"].includes(req.method)) {
      return appSettings(req, res);
    }
    if (req.method === "GET" && url.pathname === "/v1/admin/settings/app/history") {
      return appSettingsHistory(req, res);
    }
    const restoreSettingsMatch = /^\/v1\/admin\/settings\/app\/history\/([0-9a-f-]{36})\/restore$/.exec(url.pathname);
    if (req.method === "POST" && restoreSettingsMatch) {
      return restoreAppSettings(req, res, restoreSettingsMatch[1]);
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
}

const server = http.createServer((req, res) => {
  void handleHttpRequest(req, res).catch(async (error) => {
    const status = Number(error?.statusCode) || 500;
    const message = String(error?.message || error || "حدث خطأ في الخادم");
    if (status >= 500) {
      console.error("[ASHUR REQUEST UNCAUGHT]", error);
      await logSystemError("api-request", error, {
        method: String(req.method || ""),
        path: String(req.url || "").slice(0, 500),
      }).catch(() => {});
    } else {
      console.warn("[ASHUR REQUEST]", status, message);
    }

    if (res.writableEnded) return;
    if (res.headersSent) {
      try { res.end(); } catch {}
      return;
    }

    try {
      json(res, status, {
        error: status < 500 ? message : "حدث خطأ في الخادم",
      });
    } catch {
      try { res.end(); } catch {}
    }
  });
});

server.listen(config.port, "0.0.0.0", () => {
  console.log(`ASHUR listening on ${config.port}`);
  console.log("Readiness:", readiness());
});

const worker = setInterval(() => {
  processNotificationOutbox().catch(() => {});
  processScheduledAdminNotifications().catch(() => {});
  processMediaCleanupJobs().catch(() => {});
}, 5000);
worker.unref();
const cleaner = setInterval(() => cleanupCache().catch(() => {}), 10 * 60_000);
cleaner.unref();

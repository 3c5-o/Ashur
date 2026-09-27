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
    `select=id,name,username,is_private,is_banned,banned_until,ban_reason,warning_count,deleted_at&limit=1&id=eq.${encodeURIComponent(userId)}`,
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
  if (profile.is_banned) return true;
  if (profile.banned_until && new Date(profile.banned_until) > new Date()) return true;
  return false;
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

async function writeAudit(actorUserId, action, targetType = null, targetId = null, details = {}) {
  return insert("audit_logs", {
    actor_user_id: actorUserId || null,
    action,
    target_type: targetType,
    target_id: targetId == null ? null : String(targetId),
    details: details || {},
  }, { returning: false }).catch(() => {});
}

async function logSystemError(service, error, context = {}, userId = null) {
  return insert("system_errors", {
    service: String(service || "api").slice(0, 80),
    code: String(error?.code || error?.statusCode || "").slice(0, 80),
    message: String(error?.message || error || "Unknown error").slice(0, 1500),
    context: context || {},
    user_id: userId || null,
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

async function handleUpload(req, res, url) {
  const user = await currentUser(req);
  const profile = await profileFor(user.id);
  if (profileIsBanned(profile)) {
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

  let job = null;
  let received = null;
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
        size_bytes: declared || 0,
        received_bytes: 0,
        status: "queued",
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
          cancel_requested: false,
          updated_at: new Date().toISOString(),
          completed_at: null,
        },
        { returning: false },
      );
    }

    received = await receiveFile(req, maxBytes, job?.id || null);
    if (job?.id) {
      await update(
        "upload_jobs",
        "id=eq." + encodeURIComponent(job.id),
        {
          size_bytes: received.size,
          received_bytes: received.size,
          status: "storing",
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

    const uploaded = await uploadToChannel({
      channelId: channel.channel_id,
      filePath: received.filePath,
      caption: "آشور · " + kind + " · " + user.id,
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
    const media = rows?.[0] || {};

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
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { returning: false },
      ).catch(() => {});
    }

    json(res, 201, { ...media, upload_job_id: job?.id || null });
  } catch (error) {
    if (job?.id) {
      await update(
        "upload_jobs",
        "id=eq." + encodeURIComponent(job.id),
        {
          status: error.statusCode === 499 ? "cancelled" : "failed",
          error: String(error.message || error).slice(0, 1000),
          updated_at: new Date().toISOString(),
        },
        { returning: false },
      ).catch(() => {});
    }
    if (error.statusCode !== 499) {
      await logSystemError("upload", error, { kind, client_upload_id: clientUploadId }, user.id);
    }
    throw error;
  } finally {
    if (received?.filePath) {
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
    items.push({
      ...conversation,
      title: title || "محادثة",
      peer_profile: peerProfile,
      last_message: messages?.[0]?.body || "",
      updated_at: messages?.[0]?.created_at || conversation.updated_at,
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

  if (kind === "direct") {
    const targetUserId = memberIds.find((id) => id !== user.id);
    if (await isBlockedBetween(user.id, targetUserId)) {
      const error = new Error("لا يمكن بدء محادثة مع هذا الحساب");
      error.statusCode = 403;
      throw error;
    }
    const mine = await select(
      "conversation_members",
      `select=conversation_id&user_id=eq.${encodeURIComponent(user.id)}&limit=200`,
    );
    const candidateIds = (mine || []).map((row) => row.conversation_id);
    if (candidateIds.length) {
      const direct = await select(
        "conversations",
        `select=id,kind,title,image_media_id,updated_at&id=in.(${candidateIds.join(",")})&kind=eq.direct&limit=200`,
      );
      for (const conversation of direct || []) {
        const other = await select(
          "conversation_members",
          `select=user_id&conversation_id=eq.${encodeURIComponent(conversation.id)}&user_id=eq.${encodeURIComponent(targetUserId)}&limit=1`,
        );
        if (other?.[0]) {
          return json(res, 200, conversation);
        }
      }
    }
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

async function socialSupport(req, res) {
  const user = await currentUser(req);
  const body = await readJson(req);
  const subject = String(body.subject || "").trim().slice(0, 160);
  const message = String(body.body || "").trim().slice(0, 4000);
  if (!subject || !message) return json(res, 400, { error: "اكتب عنوان المشكلة وتفاصيلها" });
  const rows = await insert("support_tickets", {
    user_id: user.id,
    category: String(body.category || "general").slice(0, 60),
    subject,
    body: message,
    app_version: String(body.app_version || "").slice(0, 40),
    device_info: String(body.device_info || "").slice(0, 300),
  });
  json(res, 201, rows?.[0] || { ok: true });
}

async function socialSupportList(req, res) {
  const user = await currentUser(req);
  const rows = await select(
    "support_tickets",
    "select=id,category,subject,body,status,priority,admin_reply,created_at,updated_at,closed_at&user_id=eq." +
      encodeURIComponent(user.id) + "&order=created_at.desc&limit=100",
  );
  json(res, 200, { items: rows || [] });
}

async function socialSave(req, res) {
  const user = await currentUser(req);
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
  if (!(await canViewOwner(user, story.author_id))) return json(res, 403, { error: "لا يمكنك مشاهدة هذه القصة" });
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
  const items = [];
  for (const row of rows || []) {
    const p = await select(
      "profiles",
      "select=id,name,username,avatar_media_id,is_verified&id=eq." + encodeURIComponent(row.user_id) + "&limit=1",
    );
    if (p?.[0]) items.push({ ...p[0], viewed_at: row.viewed_at });
  }
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
  const rows = await select("follows", "select=" + idField + ",created_at&" + filter + "&status=eq.accepted&order=created_at.desc&limit=500");
  const items = [];
  for (const row of rows || []) {
    const id = row[idField];
    if (await isBlockedBetween(user.id, id)) continue;
    const p = await select(
      "profiles",
      "select=id,name,username,avatar_media_id,is_verified,is_private&id=eq." + encodeURIComponent(id) + "&is_banned=eq.false&limit=1",
    );
    if (p?.[0]) items.push(p[0]);
  }
  json(res, 200, { items });
}

async function socialMessageRead(req, res) {
  const user = await currentUser(req);
  const body = await readJson(req);
  const ids = Array.isArray(body.message_ids) ? body.message_ids.filter((x) => /^[0-9a-f-]{36}$/i.test(String(x))).slice(0, 200) : [];
  if (!ids.length) return json(res, 200, { ok: true, count: 0 });
  const rows = ids.map((messageId) => ({ message_id: messageId, user_id: user.id, read_at: new Date().toISOString() }));
  await upsert("message_reads", rows, "message_id,user_id");
  json(res, 200, { ok: true, count: rows.length });
}

async function socialEditContent(req, res, kind, id) {
  const user = await currentUser(req);
  const table = ({ posts: "posts", reels: "reels", stories: "stories" })[kind];
  if (!table) return json(res, 400, { error: "نوع المحتوى غير صالح" });
  const rows = await select(table, "select=id,author_id&id=eq." + encodeURIComponent(id) + "&limit=1");
  if (!rows?.[0]) return json(res, 404, { error: "المحتوى غير موجود" });
  if (rows[0].author_id !== user.id) return json(res, 403, { error: "لا يمكنك تعديل هذا المحتوى" });
  const body = await readJson(req);
  const patch = {};
  if (body.caption !== undefined) patch.caption = String(body.caption || "").slice(0, 2200);
  if (body.comments_enabled !== undefined && table !== "stories") patch.comments_enabled = Boolean(body.comments_enabled);
  if (body.visibility !== undefined && table !== "stories") patch.visibility = ["public", "followers"].includes(body.visibility) ? body.visibility : "public";
  if (table === "posts") patch.updated_at = new Date().toISOString();
  if (!Object.keys(patch).length) return json(res, 400, { error: "لا توجد تعديلات" });
  const updated = await update(table, "id=eq." + encodeURIComponent(id), patch);
  json(res, 200, updated?.[0] || { ok: true });
}

async function socialDeleteContent(req, res, kind, id) {
  const user = await currentUser(req);
  const table = ({ posts: "posts", reels: "reels", stories: "stories" })[kind];
  if (!table) return json(res, 400, { error: "نوع المحتوى غير صالح" });
  const rows = await select(table, "select=id,author_id&id=eq." + encodeURIComponent(id) + "&limit=1");
  if (!rows?.[0]) return json(res, 404, { error: "المحتوى غير موجود" });
  if (rows[0].author_id !== user.id) return json(res, 403, { error: "لا يمكنك حذف هذا المحتوى" });
  await remove(table, "id=eq." + encodeURIComponent(id));
  json(res, 200, { ok: true });
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

async function socialDeleteAccount(req, res) {
  const user = await currentUser(req);
  const body = await readJson(req);
  if (String(body.confirm || "") !== "DELETE") return json(res, 400, { error: "تأكيد حذف الحساب غير صحيح" });
  await update("profiles", "id=eq." + encodeURIComponent(user.id), {
    deleted_at: new Date().toISOString(),
    is_banned: true,
    ban_reason: "account_deleted",
  }, { returning: false }).catch(() => {});
  await writeAudit(user.id, "delete_own_account", "profile", user.id, {});
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

async function adminUsers(req, res, url) {
  await requireAdmin(req, "users");
  const q = (url.searchParams.get("q") || "").trim().replace(/[,*()]/g, "");
  const query = q
    ? `select=id,name,username,is_banned,is_verified,is_private,banned_until,ban_reason,warning_count,last_seen_at,created_at&or=(name.ilike.*${encodeURIComponent(q)}*,username.ilike.*${encodeURIComponent(q)}*,id.eq.${encodeURIComponent(q)})&order=created_at.desc&limit=50`
    : "select=id,name,username,is_banned,is_verified,is_private,banned_until,ban_reason,warning_count,last_seen_at,created_at&order=created_at.desc&limit=50";
  const items = await select("profiles", query);
  json(res, 200, { items: items || [] });
}

async function setBan(req, res, userId) {
  const actor = await requireAdmin(req, "users");
  const body = await readJson(req);
  const banned = Boolean(body.banned);
  const hours = Number(body.duration_hours || 0);
  const bannedUntil = banned && Number.isFinite(hours) && hours > 0
    ? new Date(Date.now() + Math.min(hours, 24 * 365) * 3600_000).toISOString()
    : null;
  const reason = String(body.reason || "").trim().slice(0, 500);
  await update(
    "profiles",
    "id=eq." + encodeURIComponent(userId),
    {
      is_banned: banned,
      banned_until: bannedUntil,
      ban_reason: banned ? reason : "",
    },
    { returning: false },
  );
  await writeAudit(actor.user.id, banned ? "ban_user" : "unban_user", "profile", userId, {
    reason,
    duration_hours: hours > 0 ? hours : null,
    banned_until: bannedUntil,
  });
  json(res, 200, { ok: true, banned, banned_until: bannedUntil });
}


async function adminUserDetail(req, res, userId) {
  await requireAdmin(req, "users");
  const profiles = await select(
    "profiles",
    "select=id,name,username,bio,profile_link,avatar_media_id,cover_media_id,is_private,is_verified,is_banned,banned_until,ban_reason,warning_count,last_seen_at,created_at,updated_at&id=eq." + encodeURIComponent(userId) + "&limit=1",
  );
  const profile = profiles?.[0];
  if (!profile) return json(res, 404, { error: "الحساب غير موجود" });
  const [posts, reels, stories, followers, following, reports] = await Promise.all([
    count("posts", "author_id=eq." + encodeURIComponent(userId)),
    count("reels", "author_id=eq." + encodeURIComponent(userId)),
    count("stories", "author_id=eq." + encodeURIComponent(userId)),
    count("follows", "following_id=eq." + encodeURIComponent(userId) + "&status=eq.accepted"),
    count("follows", "follower_id=eq." + encodeURIComponent(userId) + "&status=eq.accepted"),
    count("reports", "target_type=eq.profile&target_id=eq." + encodeURIComponent(userId)),
  ]);
  json(res, 200, { profile, stats: { posts, reels, stories, followers, following, reports } });
}

async function adminUserAction(req, res, userId) {
  const actor = await requireAdmin(req, "users");
  const body = await readJson(req);
  const action = String(body.action || "");
  if (action === "verify" || action === "unverify") {
    await update("profiles", "id=eq." + encodeURIComponent(userId), {
      is_verified: action === "verify",
    }, { returning: false });
  } else if (action === "warn") {
    const rows = await select("profiles", "select=warning_count&id=eq." + encodeURIComponent(userId) + "&limit=1");
    if (!rows?.[0]) return json(res, 404, { error: "الحساب غير موجود" });
    await update("profiles", "id=eq." + encodeURIComponent(userId), {
      warning_count: Number(rows[0].warning_count || 0) + 1,
    }, { returning: false });
    const title = "تنبيه من إدارة آشور";
    const message = String(body.reason || "يرجى مراجعة استخدامك للمنصة.").slice(0, 500);
    await insert("notifications", {
      user_id: userId,
      actor_id: actor.user.id,
      kind: "system",
      title,
      body: message,
    }, { returning: false }).catch(() => {});
    await sendPush({ userIds: [userId], title, body: message, data: { kind: "system" } }).catch(() => {});
  } else if (action === "unban") {
    await update("profiles", "id=eq." + encodeURIComponent(userId), {
      is_banned: false,
      banned_until: null,
      ban_reason: "",
    }, { returning: false });
  } else {
    return json(res, 400, { error: "الإجراء غير مدعوم" });
  }
  await writeAudit(actor.user.id, "user_" + action, "profile", userId, {
    reason: String(body.reason || "").slice(0, 500),
  });
  json(res, 200, { ok: true });
}

async function adminComments(req, res, url) {
  await requireAdmin(req, "content");
  const q = String(url.searchParams.get("q") || "").trim().replace(/[,*()]/g, "");
  const status = String(url.searchParams.get("status") || "").trim();
  let query = "select=id,author_id,post_id,reel_id,parent_id,body,moderation_status,deleted_at,created_at,updated_at&order=created_at.desc&limit=150";
  if (q) query += "&body=ilike.*" + encodeURIComponent(q) + "*";
  if (status) query += "&moderation_status=eq." + encodeURIComponent(status);
  const rows = await select("comments", query);
  const items = [];
  for (const row of rows || []) {
    const p = await select("profiles", "select=id,name,username,avatar_media_id,is_verified&id=eq." + encodeURIComponent(row.author_id) + "&limit=1").catch(() => []);
    items.push({ ...row, author: p?.[0] || null });
  }
  json(res, 200, { items });
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

async function reportAction(req, res, reportId) {
  const actor = await requireAdmin(req, "reports");
  const body = await readJson(req);
  const rows = await select(
    "reports",
    "select=id,target_type,target_id,status&id=eq." + encodeURIComponent(reportId) + "&limit=1",
  );
  const report = rows?.[0];
  if (!report) return json(res, 404, { error: "البلاغ غير موجود" });
  const status = ["open", "review", "resolved", "rejected"].includes(body.status) ? body.status : "resolved";
  const action = String(body.action || "").slice(0, 80);
  await update("reports", "id=eq." + encodeURIComponent(reportId), {
    status,
    admin_note: String(body.admin_note || "").slice(0, 1500),
    action_taken: action,
    handled_by: actor.user.id,
    resolved_at: ["resolved", "rejected"].includes(status) ? new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
  }, { returning: false });

  if (action === "hide_content" && ["post", "reel", "story", "comment"].includes(report.target_type)) {
    const table = ({ post: "posts", reel: "reels", story: "stories", comment: "comments" })[report.target_type];
    await update(table, "id=eq." + encodeURIComponent(report.target_id), {
      moderation_status: "hidden",
      hidden_by: actor.user.id,
    }, { returning: false }).catch(() => {});
  }
  await writeAudit(actor.user.id, "report_" + status, "report", reportId, {
    action,
    target_type: report.target_type,
    target_id: report.target_id,
  });
  json(res, 200, { ok: true });
}

async function updateAdminRecord(req, res, adminUserId) {
  const actor = await requireAdmin(req, "admins");
  if (actor.admin.role !== "owner" && actor.admin.role !== "secondary_admin") {
    return json(res, 403, { error: "إدارة المشرفين متاحة للإدارة العليا فقط" });
  }
  const body = await readJson(req);
  const allowed = ["secondary_admin", "moderator", "content_moderator", "support", "analyst"];
  const patch = { updated_at: new Date().toISOString() };
  if (body.role !== undefined) {
    if (!allowed.includes(body.role)) return json(res, 400, { error: "الدور غير صالح" });
    patch.role = body.role;
  }
  if (body.permissions !== undefined) patch.permissions = body.permissions || {};
  if (body.active !== undefined) patch.active = Boolean(body.active);
  await update("admins", "user_id=eq." + encodeURIComponent(adminUserId), patch, { returning: false });
  await writeAudit(actor.user.id, "update_admin", "admin", adminUserId, patch);
  json(res, 200, { ok: true });
}

async function adminUploads(req, res, url) {
  await requireAdmin(req, "storage");
  const status = String(url.searchParams.get("status") || "").trim();
  let query = "select=id,client_upload_id,user_id,kind,original_name,size_bytes,received_bytes,status,error,media_id,cancel_requested,created_at,updated_at,completed_at&order=created_at.desc&limit=200";
  if (status) query += "&status=eq." + encodeURIComponent(status);
  const rows = await select("upload_jobs", query);
  json(res, 200, { items: rows || [] });
}

async function adminCancelUpload(req, res, jobId) {
  const actor = await requireAdmin(req, "storage");
  await update("upload_jobs", "id=eq." + encodeURIComponent(jobId), {
    cancel_requested: true,
    updated_at: new Date().toISOString(),
  }, { returning: false });
  await writeAudit(actor.user.id, "cancel_upload", "upload_job", jobId, {});
  json(res, 200, { ok: true });
}

async function adminErrors(req, res, url) {
  await requireAdmin(req, "storage");
  const status = String(url.searchParams.get("status") || "").trim();
  let query = "select=id,service,code,message,context,user_id,status,created_at,resolved_at&order=created_at.desc&limit=200";
  if (status) query += "&status=eq." + encodeURIComponent(status);
  const rows = await select("system_errors", query);
  json(res, 200, { items: rows || [] });
}

async function resolveSystemError(req, res, errorId) {
  const actor = await requireAdmin(req, "storage");
  await update("system_errors", "id=eq." + encodeURIComponent(errorId), {
    status: "resolved",
    resolved_at: new Date().toISOString(),
  }, { returning: false });
  await writeAudit(actor.user.id, "resolve_system_error", "system_error", errorId, {});
  json(res, 200, { ok: true });
}

async function adminSupport(req, res, url) {
  await requireAdmin(req, "support");
  const status = String(url.searchParams.get("status") || "").trim();
  let query = "select=id,user_id,category,subject,body,status,priority,admin_reply,assigned_to,app_version,device_info,created_at,updated_at,closed_at&order=created_at.desc&limit=200";
  if (status) query += "&status=eq." + encodeURIComponent(status);
  const rows = await select("support_tickets", query);
  json(res, 200, { items: rows || [] });
}

async function replySupport(req, res, ticketId) {
  const actor = await requireAdmin(req, "support");
  const body = await readJson(req);
  const rows = await select("support_tickets", "select=id,user_id,status&id=eq." + encodeURIComponent(ticketId) + "&limit=1");
  const ticket = rows?.[0];
  if (!ticket) return json(res, 404, { error: "التذكرة غير موجودة" });
  const reply = String(body.reply || "").trim().slice(0, 4000);
  const status = ["open", "in_progress", "answered", "closed"].includes(body.status) ? body.status : "answered";
  await update("support_tickets", "id=eq." + encodeURIComponent(ticketId), {
    admin_reply: reply,
    status,
    assigned_to: actor.user.id,
    updated_at: new Date().toISOString(),
    closed_at: status === "closed" ? new Date().toISOString() : null,
  }, { returning: false });
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
  }
  await writeAudit(actor.user.id, "reply_support", "support_ticket", ticketId, { status });
  json(res, 200, { ok: true });
}

async function adminReleases(req, res) {
  const actor = await requireAdmin(req, "settings");
  if (req.method === "GET") {
    const rows = await select(
      "app_releases",
      "select=id,version,version_code,download_url,notes,required,minimum_version,status,created_by,created_at,published_at&order=created_at.desc&limit=100",
    );
    return json(res, 200, { items: rows || [] });
  }
  const body = await readJson(req);
  const version = String(body.version || "").trim().slice(0, 40);
  const code = Number(body.version_code || 0);
  if (!version || !Number.isInteger(code) || code < 1) return json(res, 400, { error: "رقم الإصدار غير صالح" });
  const rows = await insert("app_releases", {
    version,
    version_code: code,
    download_url: String(body.download_url || "").slice(0, 500),
    notes: String(body.notes || "").slice(0, 4000),
    required: Boolean(body.required),
    minimum_version: String(body.minimum_version || "").slice(0, 40),
    status: ["draft", "testing", "published", "retired"].includes(body.status) ? body.status : "draft",
    created_by: actor.user.id,
    published_at: body.status === "published" ? new Date().toISOString() : null,
  });
  await writeAudit(actor.user.id, "create_release", "app_release", rows?.[0]?.id || null, { version, version_code: code });
  json(res, 201, rows?.[0] || { ok: true });
}

async function updateRelease(req, res, releaseId) {
  const actor = await requireAdmin(req, "settings");
  const body = await readJson(req);
  const patch = {};
  for (const key of ["download_url", "notes", "minimum_version"]) {
    if (body[key] !== undefined) patch[key] = String(body[key] || "").slice(0, key === "notes" ? 4000 : 500);
  }
  if (body.required !== undefined) patch.required = Boolean(body.required);
  if (body.status !== undefined && ["draft", "testing", "published", "retired"].includes(body.status)) {
    patch.status = body.status;
    patch.published_at = body.status === "published" ? new Date().toISOString() : null;
  }
  await update("app_releases", "id=eq." + encodeURIComponent(releaseId), patch, { returning: false });
  await writeAudit(actor.user.id, "update_release", "app_release", releaseId, patch);
  json(res, 200, { ok: true });
}

async function testAdminChannel(req, res, channelKey) {
  const actor = await requireAdmin(req, "storage");
  const rows = await select(
    "storage_channels",
    "select=channel_key,channel_id,title&channel_key=eq." + encodeURIComponent(channelKey) + "&limit=1",
  );
  const channel = rows?.[0];
  if (!channel) return json(res, 404, { error: "القناة غير موجودة" });
  const result = await testTelegramConnection().catch((error) => ({ ok: false, detail: error.message }));
  await update("storage_channels", "channel_key=eq." + encodeURIComponent(channelKey), {
    status: result.ok ? "connected" : "error",
    last_test_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }, { returning: false });
  await writeAudit(actor.user.id, "test_storage_channel", "storage_channel", channelKey, result);
  json(res, result.ok ? 200 : 503, result);
}

async function adminNotificationHistory(req, res) {
  await requireAdmin(req, "notifications");
  const rows = await select(
    "admin_notification_history",
    "select=id,actor_user_id,title,body,audience,target_user_id,deep_link,scheduled_at,sent_at,status,push_result,created_at&order=created_at.desc&limit=200",
  );
  json(res, 200, { items: rows || [] });
}

async function adminContent(req, res, url) {
  await requireAdmin(req, "content");
  const kind = url.searchParams.get("kind") || "posts";
  const table = ({ posts: "posts", reels: "reels", stories: "stories" })[kind];
  if (!table) return json(res, 400, { error: "نوع المحتوى غير صالح" });
  const status = String(url.searchParams.get("status") || "").trim();
  const authorId = String(url.searchParams.get("author_id") || "").trim();
  const q = String(url.searchParams.get("q") || "").trim().replace(/[,*()]/g, "");
  let fields = "id,author_id,caption,created_at,moderation_status,deleted_at,hidden_by";
  if (table === "stories") fields += ",expires_at,media_id";
  if (table === "reels") fields += ",media_id,comments_enabled,explore_enabled,visibility";
  if (table === "posts") fields += ",comments_enabled,visibility,updated_at";
  let query = "select=" + fields + "&order=created_at.desc&limit=150";
  if (status) query += "&moderation_status=eq." + encodeURIComponent(status);
  if (authorId) query += "&author_id=eq." + encodeURIComponent(authorId);
  if (q) query += "&caption=ilike.*" + encodeURIComponent(q) + "*";
  const rows = await select(table, query);
  const items = [];
  for (const row of rows || []) {
    const author = await select(
      "profiles",
      "select=id,name,username,avatar_media_id,is_verified&id=eq." + encodeURIComponent(row.author_id) + "&limit=1",
    ).catch(() => []);
    let media_ids = [];
    if (kind === "posts") {
      const media = await select(
        "post_media",
        "select=media_id,sort_order&post_id=eq." + encodeURIComponent(row.id) + "&order=sort_order.asc",
      ).catch(() => []);
      media_ids = (media || []).map((m) => m.media_id);
    } else if (row.media_id) {
      media_ids = [row.media_id];
    }
    items.push({ ...row, author: author?.[0] || null, media_ids });
  }
  json(res, 200, { items });
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
    "select=id,reporter_id,target_type,target_id,reason,details,status,admin_note,handled_by,action_taken,created_at,updated_at,resolved_at&order=created_at.desc&limit=200",
  );
  const enriched = [];
  for (const row of items || []) {
    const reporter = await select(
      "profiles",
      "select=id,name,username,avatar_media_id,is_verified&id=eq." + encodeURIComponent(row.reporter_id) + "&limit=1",
    ).catch(() => []);
    enriched.push({ ...row, reporter: reporter?.[0] || null });
  }
  json(res, 200, { items: enriched });
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

async function addAdmin(req, res) {
  const actor = await requireAdmin(req, "admins");
  const body = await readJson(req);
  const userId = String(body.user_id || "").trim();
  const role = String(body.role || "").trim();
  const allowed = ["secondary_admin","moderator","content_moderator","support","analyst"];
  if (!/^[0-9a-f-]{36}$/.test(userId)) return json(res, 400, { error: "معرف المستخدم غير صالح" });
  if (!allowed.includes(role)) return json(res, 400, { error: "الدور غير صالح" });

  const profiles = await select(
    "profiles",
    `select=id,name,username&id=eq.${encodeURIComponent(userId)}&limit=1`,
  );
  if (!profiles?.[0]) return json(res, 404, { error: "الحساب غير موجود" });

  const rows = await upsert("admins", {
    user_id: userId,
    role,
    permissions: body.permissions || {},
    active: true,
  }, "user_id");

  await insert("audit_logs", {
    actor_user_id: actor.user.id,
    action: "add_admin",
    target_type: "admin",
    target_id: userId,
    details: { role },
  }, { returning: false }).catch(() => {});

  json(res, 201, rows?.[0] || { ok: true });
}

async function adminAdmins(req, res) {
  await requireAdmin(req, "admins");
  const rows = await select(
    "admins",
    "select=user_id,role,permissions,active,last_active_at,created_at,updated_at&order=created_at.asc",
  );
  const items = [];
  for (const row of rows || []) {
    const profiles = await select(
      "profiles",
      `select=id,name,username&id=eq.${encodeURIComponent(row.user_id)}&limit=1`,
    );
    items.push({ ...row, profiles: profiles?.[0] || null });
  }
  json(res, 200, { items });
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

    const adminUserDetailMatch = /^\/v1\/admin\/users\/([0-9a-f-]{36})$/.exec(url.pathname);
    if (req.method === "GET" && adminUserDetailMatch) {
      return adminUserDetail(req, res, adminUserDetailMatch[1]);
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
      return adminReports(req, res);
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
    const channelTestMatch = /^\/v1\/admin\/channels\/([^/]+)\/test$/.exec(url.pathname);
    if (req.method === "POST" && channelTestMatch) {
      return testAdminChannel(req, res, decodeURIComponent(channelTestMatch[1]));
    }
    if (req.method === "GET" && url.pathname === "/v1/admin/uploads") {
      return adminUploads(req, res, url);
    }
    const adminUploadCancelMatch = /^\/v1\/admin\/uploads\/([0-9a-f-]{36})\/cancel$/.exec(url.pathname);
    if (req.method === "POST" && adminUploadCancelMatch) {
      return adminCancelUpload(req, res, adminUploadCancelMatch[1]);
    }
    if (req.method === "GET" && url.pathname === "/v1/admin/errors") {
      return adminErrors(req, res, url);
    }
    const errorResolveMatch = /^\/v1\/admin\/errors\/(\d+)\/resolve$/.exec(url.pathname);
    if (req.method === "POST" && errorResolveMatch) {
      return resolveSystemError(req, res, errorResolveMatch[1]);
    }
    if (req.method === "GET" && url.pathname === "/v1/admin/support") {
      return adminSupport(req, res, url);
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
      return adminNotificationHistory(req, res);
    }


    if (url.pathname === "/v1/admin/admins") {
      if (req.method === "GET") return adminAdmins(req, res);
      if (req.method === "POST") return addAdmin(req, res);
    }
    const adminRecordMatch = /^\/v1\/admin\/admins\/([0-9a-f-]{36})$/.exec(url.pathname);
    if (req.method === "PATCH" && adminRecordMatch) {
      return updateAdminRecord(req, res, adminRecordMatch[1]);
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

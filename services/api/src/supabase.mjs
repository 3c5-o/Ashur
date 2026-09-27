import { config } from "./config.mjs";

function requireBase() {
  if (!config.supabaseUrl) throw new Error("لم يتم إعداد رابط قاعدة البيانات");
}

function serviceHeaders(extra = {}) {
  if (!config.serviceRoleKey) throw new Error("لم يتم إعداد مفتاح الخادم لقاعدة البيانات");
  return {
    apikey: config.serviceRoleKey,
    Authorization: `Bearer ${config.serviceRoleKey}`,
    ...extra,
  };
}

async function parseResponse(response) {
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!response.ok) {
    const detail = body?.message || body?.msg || body?.error_description || body?.error || text;
    throw new Error(detail || `خطأ في قاعدة البيانات (${response.status})`);
  }
  return body;
}

export async function verifyUserToken(token) {
  requireBase();
  if (!token || !config.publishableKey) return null;
  const response = await fetch(`${config.supabaseUrl}/auth/v1/user`, {
    headers: {
      apikey: config.publishableKey,
      Authorization: `Bearer ${token}`,
    },
  });
  if (!response.ok) return null;
  return response.json();
}

export async function serviceRequest(path, {
  method = "GET",
  body,
  prefer,
  headers = {},
} = {}) {
  requireBase();
  const finalHeaders = serviceHeaders({
    ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    ...(prefer ? { Prefer: prefer } : {}),
    ...headers,
  });
  const response = await fetch(`${config.supabaseUrl}${path}`, {
    method,
    headers: finalHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return parseResponse(response);
}

export function filterValue(value) {
  return encodeURIComponent(String(value));
}

export async function select(table, query = "") {
  return serviceRequest(`/rest/v1/${table}${query ? "?" + query : ""}`);
}

export async function insert(table, body, { returning = true } = {}) {
  return serviceRequest(`/rest/v1/${table}`, {
    method: "POST",
    body,
    prefer: returning ? "return=representation" : "return=minimal",
  });
}

export async function update(table, query, body, { returning = true } = {}) {
  return serviceRequest(`/rest/v1/${table}?${query}`, {
    method: "PATCH",
    body,
    prefer: returning ? "return=representation" : "return=minimal",
  });
}

export async function remove(table, query) {
  return serviceRequest(`/rest/v1/${table}?${query}`, {
    method: "DELETE",
    prefer: "return=representation",
  });
}

export async function upsert(table, body, onConflict) {
  const suffix = onConflict ? `?on_conflict=${encodeURIComponent(onConflict)}` : "";
  return serviceRequest(`/rest/v1/${table}${suffix}`, {
    method: "POST",
    body,
    prefer: "resolution=merge-duplicates,return=representation",
  });
}

export async function count(table, query = "") {
  requireBase();
  const response = await fetch(
    `${config.supabaseUrl}/rest/v1/${table}?${query}`,
    {
      method: "HEAD",
      headers: serviceHeaders({ Prefer: "count=exact" }),
    },
  );
  if (!response.ok) throw new Error(`تعذر عد سجلات ${table}`);
  const range = response.headers.get("content-range") || "*/0";
  const total = Number(range.split("/")[1] || 0);
  return Number.isFinite(total) ? total : 0;
}

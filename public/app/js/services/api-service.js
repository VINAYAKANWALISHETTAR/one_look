/**
 * Centralized API client — the ONLY place the app talks to the backend.
 *
 * Responsibilities: base URL resolution, JSON headers, access-token attachment,
 * silent refresh on 401, and a single error shape. No module outside this file
 * calls fetch() against our API, and no secret ever lives here — the browser
 * only ever holds tokens the backend issued to this user.
 */

import { API_BASE_URL } from "../config.js";
import { STORES, readValue, writeValue, remove } from "../db/indexeddb.js";

const SESSION_KEY = "cloudSession";

export class ApiError extends Error {
  constructor(message, { status = 0, code = "network_error", details } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
    this.offline = status === 0;
  }
}

export const isConfigured = () => Boolean(API_BASE_URL);

/* ---------- Cloud session (tokens live in IndexedDB, never in localStorage) ---------- */
export async function getCloudSession() {
  return readValue(STORES.auth, SESSION_KEY);
}

async function saveCloudSession(session) {
  await writeValue(STORES.auth, SESSION_KEY, session);
  return session;
}

export async function clearCloudSession() {
  await remove(STORES.auth, SESSION_KEY);
}

export const isSignedInToCloud = async () => Boolean((await getCloudSession())?.accessToken);

/* ---------- Core request ---------- */
async function request(path, { method = "GET", body, token, retryOn401 = true } = {}) {
  if (!isConfigured())
    throw new ApiError("Cloud sync is not configured.", { code: "not_configured" });

  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;

  let response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    // Offline, DNS failure, backend down — never fatal, the app stays local.
    throw new ApiError("Cannot reach the server.", { status: 0, code: "network_error" });
  }

  if (response.status === 401 && retryOn401 && token) {
    const refreshed = await refreshSession().catch(() => null);
    if (refreshed)
      return request(path, { method, body, token: refreshed.accessToken, retryOn401: false });
  }

  const text = await response.text();
  const payload = text ? safeJson(text) : null;

  if (!response.ok) {
    const error = payload?.error || {};
    throw new ApiError(error.message || `Request failed (${response.status})`, {
      status: response.status,
      code: error.code || "server_error",
      details: error.details,
    });
  }

  return payload?.data ?? payload;
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Adds the current access token to a request. Exported so feature-specific
 * clients (mail-service) reuse the same refresh-on-401 pipeline instead of
 * calling fetch themselves.
 */
export async function authed(path, options = {}) {
  const session = await getCloudSession();
  if (!session?.accessToken)
    throw new ApiError("Not signed in to the cloud.", { code: "unauthenticated", status: 401 });
  return request(path, { ...options, token: session.accessToken });
}

async function refreshSession() {
  const session = await getCloudSession();
  if (!session?.refreshToken) return null;
  try {
    const next = await request("/auth/refresh", {
      method: "POST",
      body: { refreshToken: session.refreshToken },
      retryOn401: false,
    });
    return saveCloudSession(next);
  } catch (error) {
    // A rejected refresh token means the cloud session is over; local data stays.
    if (error.status === 401) await clearCloudSession();
    throw error;
  }
}

/* ---------- Health ---------- */
export async function health() {
  return request("/health");
}

/* ---------- Auth ---------- */
export async function registerCloud({ email, password, displayName }) {
  return saveCloudSession(
    await request("/auth/register", { method: "POST", body: { email, password, displayName } }),
  );
}

export async function loginCloud({ email, password }) {
  return saveCloudSession(
    await request("/auth/login", { method: "POST", body: { email, password } }),
  );
}

export async function logoutCloud() {
  const session = await getCloudSession();
  if (session?.refreshToken) {
    await request("/auth/logout", {
      method: "POST",
      body: { refreshToken: session.refreshToken },
    }).catch(() => {});
  }
  await clearCloudSession();
}

export async function me() {
  return authed("/auth/me");
}

/* ---------- Tasks / Notes (REST, used for direct reads and diagnostics) ---------- */
export const listTasks = (since) =>
  authed(`/tasks${since ? `?since=${encodeURIComponent(since)}` : ""}`);
export const createTask = (task) => authed("/tasks", { method: "POST", body: task });
export const deleteTask = (id) => authed(`/tasks/${id}`, { method: "DELETE" });

export const listNotes = (since) =>
  authed(`/notes${since ? `?since=${encodeURIComponent(since)}` : ""}`);
export const createNote = (note) => authed("/notes", { method: "POST", body: note });
export const deleteNote = (id) => authed(`/notes/${id}`, { method: "DELETE" });

/* ---------- Sync ---------- */
export const pushSync = (payload) => authed("/sync", { method: "POST", body: payload });

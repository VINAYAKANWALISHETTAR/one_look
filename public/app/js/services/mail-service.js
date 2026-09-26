/**
 * Mail API client — the ONLY place the frontend talks to the mail endpoints.
 *
 * Every call goes to the One Look backend, never to Gmail directly. The browser
 * therefore holds no Google token, no client secret and no refresh token: it
 * only carries the One Look access token that api-service already manages.
 *
 * Read-only by design — there is no send, delete or label-modify function here.
 */

import { ApiError, authed, isConfigured, isSignedInToCloud } from "./api-service.js";
import { STORES, readValue, writeValue } from "../db/indexeddb.js";

/* ---------- Offline cache -------------------------------------------------
 * Gmail stays the source of truth. We cache only the last summary and the last
 * page of message metadata (sender, subject, snippet, date) so the Inbox can
 * show something useful with no connection. Message bodies are never cached.
 */
const CACHE_PREFIX = "mail:";
const cacheKey = (name) => `${CACHE_PREFIX}${name}`;

async function readCache(name) {
  try {
    return (await readValue(STORES.settings, cacheKey(name))) || null;
  } catch {
    return null;
  }
}

async function writeCache(name, data) {
  try {
    await writeValue(STORES.settings, cacheKey(name), { data, cachedAt: new Date().toISOString() });
  } catch {
    /* cache is best-effort; never break a live request over it */
  }
}

/** Serves cached data when the network is unavailable, flagged as stale. */
async function withCache(name, fetcher) {
  try {
    const fresh = await fetcher();
    await writeCache(name, fresh);
    return { ...fresh, stale: false, cachedAt: null };
  } catch (error) {
    if (error instanceof ApiError && (error.offline || error.status === 503)) {
      const cached = await readCache(name);
      if (cached) return { ...cached.data, stale: true, cachedAt: cached.cachedAt };
    }
    throw error;
  }
}

export const isMailAvailable = () => isConfigured();

/**
 * Gmail hangs off the One Look cloud account, so mail can only be reached once
 * the user has signed in to the backend. Callers use this to show a calm
 * "sign in first" state instead of an authentication error.
 */
export const isMailReady = async () => isConfigured() && (await isSignedInToCloud());

/* ---------- Google connection ---------- */

/**
 * Opens Google's consent screen in a popup and resolves once the backend
 * reports the connection. The popup is opened synchronously inside the click
 * handler (before any await) so browsers do not block it.
 */
export function connectGoogleAccount({ loginHint } = {}) {
  if (!isConfigured()) {
    return Promise.reject(
      new ApiError("Cloud sync is not configured.", { code: "not_configured" }),
    );
  }

  const popup = window.open("", "onelook-google", "width=520,height=680,menubar=no,toolbar=no");
  if (!popup) {
    return Promise.reject(
      new ApiError("Allow pop-ups for this site to connect Gmail.", { code: "popup_blocked" }),
    );
  }
  popup.document.write(
    "<p style='font:15px system-ui;padding:24px;color:#5b6572'>Opening Google…</p>",
  );

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      window.removeEventListener("message", onMessage);
      clearInterval(closedTimer);
      fn(value);
    };

    const onMessage = (event) => {
      if (event.data?.source !== "onelook-google-oauth") return;
      if (event.data.ok) finish(resolve, { email: event.data.email });
      else
        finish(
          reject,
          new ApiError(event.data.message || "Google sign-in failed.", { code: "oauth_failed" }),
        );
    };
    window.addEventListener("message", onMessage);

    // The popup may be closed manually, or the message may be lost across
    // origins — either way, stop waiting and let the caller re-read accounts.
    const closedTimer = setInterval(() => {
      if (popup.closed) finish(resolve, { email: null, closed: true });
    }, 700);

    const params = new URLSearchParams({ returnTo: window.location.href });
    if (loginHint) params.set("loginHint", loginHint);

    authed(`/integrations/google/connect?${params}`)
      .then(({ authorizeUrl }) => {
        popup.location.href = authorizeUrl;
      })
      .catch((error) => {
        popup.close();
        finish(reject, error);
      });
  });
}

export async function listAccounts() {
  return withCache("accounts", () => authed("/mail/accounts"));
}

export async function disconnectAccount(accountId) {
  const result = await authed(`/mail/accounts/${encodeURIComponent(accountId)}`, {
    method: "DELETE",
  });
  // Drop cached views so a disconnected account cannot linger on screen.
  await writeCache("accounts", { configured: true, accounts: [] });
  await writeCache("summary", { accounts: [], total: { unread: 0, important: 0, inbox: 0 } });
  return result;
}

/* ---------- Attention signals ---------- */

export async function summary() {
  return withCache("summary", () => authed("/mail/summary"));
}

/* ---------- Messages ---------- */

export async function listMessages(accountId, { view = "inbox", q = "", pageToken = "" } = {}) {
  const params = new URLSearchParams({ view });
  if (q) params.set("q", q);
  if (pageToken) params.set("pageToken", pageToken);
  const path = `/mail/accounts/${encodeURIComponent(accountId)}/messages?${params}`;
  // Only the first page of the default view is worth caching for offline use.
  if (view === "inbox" && !q && !pageToken) {
    return withCache(`messages:${accountId}`, () => authed(path));
  }
  return authed(path);
}

/** Message bodies are always fetched live — never stored on the device. */
export async function getMessage(accountId, messageId) {
  return authed(
    `/mail/accounts/${encodeURIComponent(accountId)}/messages/${encodeURIComponent(messageId)}`,
  );
}

/** Unified search across every connected account, run by Gmail server-side. */
export async function searchMail(query, { limit = 10 } = {}) {
  if (!query.trim()) return { query: "", messages: [], accountsSearched: 0 };
  return authed(`/mail/search?q=${encodeURIComponent(query)}&limit=${limit}`);
}

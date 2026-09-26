/**
 * Shared Google API client for connected accounts.
 *
 * One place owns the access-token lifecycle (decrypt → use → refresh → mark
 * reauth_required) and the translation of Google HTTP failures into HttpErrors.
 * Gmail and Google Calendar both build on it, so a token bug can only exist
 * once.
 *
 * Ownership is enforced by `findOwnedRow`: authenticated One Look user → owns
 * the connected account → only then is Google called. Tokens, addresses and
 * response bodies are never logged.
 */

import { logger } from "../utils/logger.js";
import { HttpError, forbidden } from "../utils/http-error.js";
import * as accounts from "./connected-account.service.js";
import { decryptToken } from "./token-crypto.service.js";
import { refreshAccessToken } from "./google-oauth.service.js";

/** Signals the frontend should show "Reconnect" for this account. */
export const reauth = (message) => new HttpError(409, "reauth_required", message);

async function accessTokenFor(row) {
  const expiresAt = row.token_expires_at ? new Date(row.token_expires_at).getTime() : 0;
  // 60s safety margin so a token cannot expire mid-request.
  if (row.access_token_encrypted && expiresAt - 60_000 > Date.now()) {
    return decryptToken(row.access_token_encrypted);
  }

  const refreshToken = row.refresh_token_encrypted
    ? decryptToken(row.refresh_token_encrypted)
    : null;
  if (!refreshToken) {
    await accounts.markReauthRequired(row.id, "No refresh token stored. Reconnect this account.");
    throw reauth("This Google account needs to be reconnected.");
  }

  try {
    const refreshed = await refreshAccessToken(refreshToken);
    await accounts.saveRefreshedAccessToken(row.id, refreshed);
    // Log the event, never the token or the address.
    logger.info("google access token refreshed", { accountId: row.id });
    return refreshed.accessToken;
  } catch (error) {
    await accounts.markReauthRequired(row.id, "Google refused to refresh access.");
    logger.warn("google token refresh failed", { accountId: row.id, googleCode: error.googleCode });
    throw reauth("Google revoked or expired this authorization. Reconnect the account.");
  }
}

/**
 * Authenticated client for one connected account.
 *
 * @param {string} userId       One Look user id (from requireAuth)
 * @param {string} accountId    connected_accounts.id
 * @param {object} options
 * @param {string} options.baseUrl  API root, e.g. the Gmail or Calendar base
 * @param {string} options.label    Product name used in user-facing errors
 * @param {string} [options.scope]  Scope this product needs; when the stored
 *                                  grant lacks it we ask for a reconnect
 *                                  instead of letting Google 403 later.
 */
export async function googleClient(userId, accountId, { baseUrl, label = "Google", scope } = {}) {
  const row = await accounts.findOwnedRow(userId, accountId);
  if (row.status === "reauth_required") throw reauth(`This account needs to be reconnected.`);

  if (scope && Array.isArray(row.scopes) && row.scopes.length && !row.scopes.includes(scope)) {
    throw new HttpError(
      409,
      "scope_required",
      `One Look does not have ${label} permission for this account yet. Reconnect it to grant read-only access.`,
    );
  }

  const token = await accessTokenFor(row);

  const call = async (path, params) => {
    const url = new URL(`${baseUrl}${path}`);
    for (const [key, value] of Object.entries(params || {})) {
      if (value === undefined || value === null || value === "") continue;
      for (const entry of [].concat(value)) url.searchParams.append(key, String(entry));
    }

    let response;
    try {
      response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    } catch {
      throw new HttpError(
        503,
        "google_unreachable",
        `${label} could not be reached. Try again shortly.`,
      );
    }

    if (response.ok) return response.json();

    const payload = await response.json().catch(() => ({}));
    const reason = payload?.error?.message || `${label} request failed (${response.status})`;
    // Status only — the query can contain search terms and the body can contain
    // personal content.
    logger.warn("google api error", { accountId: row.id, label, status: response.status });

    if (response.status === 401) {
      await accounts.markReauthRequired(row.id, "Google rejected the stored authorization.");
      throw reauth(`${label} rejected this authorization. Reconnect the account.`);
    }
    if (response.status === 403 && /insufficient|scope|permission/i.test(reason)) {
      await accounts.markReauthRequired(row.id, `Missing ${label} permissions.`);
      throw reauth(
        `One Look is missing ${label} read permission. Reconnect the account to grant it.`,
      );
    }
    if (response.status === 403) throw forbidden(`${label} refused this request.`);
    if (response.status === 404)
      throw new HttpError(404, "not_found", `That item no longer exists in ${label}.`);
    if (response.status === 429) {
      throw new HttpError(
        429,
        "google_rate_limited",
        `${label} is rate limiting requests. Try again in a moment.`,
      );
    }
    throw new HttpError(502, "google_error", `${label} returned an error.`);
  };

  return { account: accounts.publicAccount(row), row, call };
}

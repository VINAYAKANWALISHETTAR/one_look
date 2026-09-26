/**
 * Google OAuth 2.0 — the whole exchange happens server-side.
 *
 * The browser never sees the client secret, the authorization code exchange,
 * or any token. It only ever receives an authorize URL to visit and, later,
 * connection metadata (id / email / status).
 *
 * Requested scopes (minimum for Phase 5 — read only):
 *   openid                                        – identifies the Google account
 *   .../auth/userinfo.email                       – the address we display in the UI
 *   .../auth/gmail.readonly                       – read messages, labels and counts
 *   .../auth/calendar.readonly                    – read calendars and events
 * Deliberately NOT requested: gmail.send, gmail.modify, gmail.compose,
 * https://mail.google.com/ (full access). One Look never sends, deletes or
 * modifies mail, and it never creates, edits or deletes calendar events.
 */

import jwt from "jsonwebtoken";

import { config } from "../config.js";
import { badRequest, unauthorized } from "../utils/http-error.js";

export const GOOGLE_SCOPES = [
  "openid",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/calendar.readonly",
];

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke";
const USERINFO_ENDPOINT = "https://openidconnect.googleapis.com/v1/userinfo";

export const isGoogleOAuthConfigured = () =>
  Boolean(config.googleClientId && config.googleClientSecret && config.googleRedirectUri);

function assertConfigured() {
  if (!isGoogleOAuthConfigured()) {
    throw badRequest(
      "Google is not configured on this server. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REDIRECT_URI.",
    );
  }
}

/**
 * `state` is a short-lived signed JWT carrying the One Look user id. Google
 * echoes it back on the callback, which is how the callback (an unauthenticated
 * browser redirect) proves which user started the flow — CSRF protection and
 * identity in one value.
 */
export function createState(userId, returnTo) {
  return jwt.sign({ sub: userId, rt: returnTo || "" }, config.jwtSecret, {
    expiresIn: "10m",
    issuer: "onelook",
    audience: "onelook-google-oauth",
  });
}

export function readState(state) {
  try {
    const claims = jwt.verify(String(state || ""), config.jwtSecret, {
      issuer: "onelook",
      audience: "onelook-google-oauth",
    });
    return { userId: claims.sub, returnTo: claims.rt || "" };
  } catch {
    throw unauthorized("This Google connection link has expired. Start again from the Inbox.");
  }
}

export function buildAuthorizeUrl({ userId, returnTo, loginHint }) {
  assertConfigured();
  const url = new URL(AUTH_ENDPOINT);
  url.searchParams.set("client_id", config.googleClientId);
  url.searchParams.set("redirect_uri", config.googleRedirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_SCOPES.join(" "));
  // offline + consent: we need a refresh token, and we need one every time so a
  // second/third Gmail account can be added without losing the first.
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent select_account");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("state", createState(userId, returnTo));
  if (loginHint) url.searchParams.set("login_hint", loginHint);
  return url.toString();
}

async function tokenRequest(params) {
  assertConfigured();
  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(
      payload.error_description || payload.error || "Google rejected the token request.",
    );
    error.googleStatus = response.status;
    error.googleCode = payload.error || "token_error";
    throw error;
  }
  return payload;
}

/** Authorization code -> tokens. Called only from the backend callback route. */
export async function exchangeCode(code) {
  const token = await tokenRequest({
    code,
    client_id: config.googleClientId,
    client_secret: config.googleClientSecret,
    redirect_uri: config.googleRedirectUri,
    grant_type: "authorization_code",
  });
  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token || null,
    expiresAt: new Date(Date.now() + Number(token.expires_in || 3600) * 1000),
    scopes: String(token.scope || "")
      .split(" ")
      .filter(Boolean),
  };
}

export async function refreshAccessToken(refreshToken) {
  const token = await tokenRequest({
    refresh_token: refreshToken,
    client_id: config.googleClientId,
    client_secret: config.googleClientSecret,
    grant_type: "refresh_token",
  });
  return {
    accessToken: token.access_token,
    expiresAt: new Date(Date.now() + Number(token.expires_in || 3600) * 1000),
    scopes: String(token.scope || "")
      .split(" ")
      .filter(Boolean),
  };
}

/** Identifies the Google account that just authorized. */
export async function fetchUserInfo(accessToken) {
  const response = await fetch(USERINFO_ENDPOINT, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new Error("Could not read the Google account profile.");
  const info = await response.json();
  return { sub: String(info.sub), email: String(info.email || ""), name: info.name || null };
}

/** Best-effort: tell Google to drop the grant when the user disconnects. */
export async function revokeToken(token) {
  if (!token) return false;
  try {
    const response = await fetch(REVOKE_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

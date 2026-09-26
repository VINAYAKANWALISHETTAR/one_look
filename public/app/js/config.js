/**
 * App configuration — public values only.
 *
 * NEVER put secrets here. This file ships to the browser.
 * A Google OAuth *client ID* is public by design; the client *secret*,
 * refresh tokens, database credentials and API keys belong on the Node/Express
 * backend in environment variables (see backend/.env.example).
 */

/**
 * Development flag. Developer-only affordances (destructive resets, sync
 * diagnostics) are hidden from the production UI.
 */
export const IS_DEV = (() => {
  if (typeof window === "undefined") return false;
  const { hostname, search } = window.location;
  if (new URLSearchParams(search).has("dev")) return true;
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname.endsWith(".local");
})();

/**
 * Backend base URL — environment specific, never hardcoded to localhost for
 * production. Resolution order:
 *   1. ?api= query override (handy for testing a deployed API locally)
 *   2. window.ONELOOK_API_BASE_URL — injected at deploy time (S3/CloudFront)
 *   3. <meta name="onelook-api-base"> in index.html
 *   4. localhost development default (http://localhost:4000/api)
 * Empty string = cloud sync switched off; the app runs fully local.
 */
function resolveApiBaseUrl() {
  if (typeof window === "undefined") return "";
  const trim = (value) =>
    String(value || "")
      .trim()
      .replace(/\/+$/, "");

  const fromQuery = new URLSearchParams(window.location.search).get("api");
  if (fromQuery) return trim(fromQuery);

  if (window.ONELOOK_API_BASE_URL) return trim(window.ONELOOK_API_BASE_URL);

  const meta = document.querySelector('meta[name="onelook-api-base"]');
  const fromMeta = meta?.getAttribute("content");
  if (fromMeta && !fromMeta.startsWith("__")) return trim(fromMeta);

  if (IS_DEV) return "http://localhost:4000/api";

  return ""; // production without a configured API stays local-only
}

export const API_BASE_URL = resolveApiBaseUrl();

export const CONFIG = {
  appName: "One Look",

  /**
   * Google sign-in (Google Identity Services).
   * Paste your OAuth 2.0 Web client ID from Google Cloud Console →
   * APIs & Services → Credentials. Add this app's origin to
   * "Authorised JavaScript origins".
   * Leave empty to keep Google sign-in switched off.
   */
  googleClientId: "",

  /** Backend base URL (see resolveApiBaseUrl above). */
  apiBaseUrl: API_BASE_URL,

  /** How often the sync engine retries while online, in milliseconds. */
  syncIntervalMs: 60_000,
};

export const isGoogleConfigured = () => Boolean(CONFIG.googleClientId);

/** Shown on the More page. Bump when you ship a release. */
export const APP_VERSION = "6.0.0";

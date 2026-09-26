/**
 * Environment configuration. Every secret is read from the environment —
 * nothing is hardcoded and nothing here is ever shipped to the browser.
 */

import dotenv from "dotenv";

dotenv.config();

const bool = (value, fallback = false) =>
  value === undefined ? fallback : ["1", "true", "yes", "on"].includes(String(value).toLowerCase());

const list = (value) =>
  String(value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

export const config = {
  env: process.env.NODE_ENV || "development",
  port: Number(process.env.PORT || 4000),

  databaseUrl: process.env.DATABASE_URL || "",
  pgSsl: bool(process.env.PGSSL, false),
  pgPoolMax: Number(process.env.PG_POOL_MAX || 10),

  jwtSecret: process.env.JWT_SECRET || "",
  accessTokenTtl: process.env.ACCESS_TOKEN_TTL || "15m",
  refreshTokenTtlDays: Number(process.env.REFRESH_TOKEN_TTL_DAYS || 30),

  corsOrigins: list(process.env.CORS_ORIGINS),
  jsonBodyLimit: process.env.JSON_BODY_LIMIT || "256kb",

  // --- Google / Gmail (Phase 5) -----------------------------------------
  // The client secret lives ONLY here, on the server. The browser receives an
  // authorize URL, never a credential.
  googleClientId: process.env.GOOGLE_CLIENT_ID || "",
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
  googleRedirectUri: process.env.GOOGLE_REDIRECT_URI || "",
  // AES-256-GCM key (32 bytes, base64) used to encrypt stored OAuth tokens.
  tokenEncryptionKey: process.env.TOKEN_ENCRYPTION_KEY || "",
  // Where the app is served from; used to send the user back after OAuth.
  appOrigin: process.env.APP_ORIGIN || "",
};

export const isProduction = config.env === "production";

export const isGoogleConfigured = () =>
  Boolean(config.googleClientId && config.googleClientSecret && config.googleRedirectUri);

/** Fail fast rather than boot an insecure server. */
export function assertConfig() {
  const missing = [];
  if (!config.databaseUrl) missing.push("DATABASE_URL");
  if (!config.jwtSecret || config.jwtSecret.length < 16) missing.push("JWT_SECRET");
  if (missing.length)
    throw new Error(`Missing/invalid environment variables: ${missing.join(", ")}`);
  if (isProduction && config.jwtSecret === "change-me-in-every-environment") {
    throw new Error("JWT_SECRET must be changed in production.");
  }
  if (isProduction && config.corsOrigins.length === 0) {
    throw new Error("CORS_ORIGINS must list the production frontend origin(s).");
  }
  // Gmail is optional: without it One Look runs exactly as it did in Phase 4.
  // But a half-configured integration would store tokens it cannot protect.
  if (isGoogleConfigured() && !config.tokenEncryptionKey) {
    throw new Error(
      "TOKEN_ENCRYPTION_KEY is required when Google OAuth is configured (openssl rand -base64 32).",
    );
  }
  if (isProduction && isGoogleConfigured() && !config.googleRedirectUri.startsWith("https://")) {
    throw new Error("GOOGLE_REDIRECT_URI must be https in production.");
  }
}

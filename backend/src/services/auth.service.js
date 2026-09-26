/**
 * Auth service — identity lives on the server.
 *
 * Passwords: scrypt (Node crypto, memory-hard, no native build) with a random
 * 16-byte salt per user. Plaintext is never stored or logged.
 * Sessions: short-lived signed JWT access token + long-lived opaque refresh
 * token whose SHA-256 hash only is stored. Google OAuth slots in later by
 * calling `upsertGoogleUser` from a Google-verified id token — the browser
 * never supplies the identity.
 */

import {
  randomBytes,
  randomUUID,
  createHash,
  scrypt as scryptCb,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";

import jwt from "jsonwebtoken";

import { config } from "../config.js";
import { query, transaction } from "../db/database.js";
import { conflict, unauthorized } from "../utils/http-error.js";

const scrypt = promisify(scryptCb);
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, SCRYPT.keylen, {
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
  });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("hex")}$${key.toString("hex")}`;
}

export async function verifyPassword(password, stored) {
  if (!stored || !stored.startsWith("scrypt$")) return false;
  const [, N, r, p, saltHex, keyHex] = stored.split("$");
  const expected = Buffer.from(keyHex, "hex");
  const actual = await scrypt(password, Buffer.from(saltHex, "hex"), expected.length, {
    N: Number(N),
    r: Number(r),
    p: Number(p),
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

const publicUser = (row) => ({
  id: row.id,
  email: row.email,
  displayName: row.display_name,
  authProvider: row.auth_provider,
  createdAt: row.created_at,
});

function signAccessToken(user) {
  return jwt.sign({ sub: user.id, email: user.email }, config.jwtSecret, {
    expiresIn: config.accessTokenTtl,
    issuer: "onelook",
    audience: "onelook-app",
  });
}

export function verifyAccessToken(token) {
  try {
    return jwt.verify(token, config.jwtSecret, { issuer: "onelook", audience: "onelook-app" });
  } catch {
    throw unauthorized("Session expired or invalid.");
  }
}

const hashToken = (token) => createHash("sha256").update(token).digest("hex");

async function issueRefreshToken(userId) {
  const token = `${randomUUID()}.${randomBytes(32).toString("hex")}`;
  const expiresAt = new Date(Date.now() + config.refreshTokenTtlDays * 86_400_000);
  await query("insert into refresh_tokens (user_id, token_hash, expires_at) values ($1, $2, $3)", [
    userId,
    hashToken(token),
    expiresAt,
  ]);
  return { token, expiresAt };
}

async function session(userRow) {
  const user = publicUser(userRow);
  const refresh = await issueRefreshToken(user.id);
  return {
    user,
    accessToken: signAccessToken(user),
    refreshToken: refresh.token,
    refreshTokenExpiresAt: refresh.expiresAt,
  };
}

export async function register({ email, password, displayName }) {
  const normalizedEmail = email.trim().toLowerCase();
  const existing = await query("select id from users where email = $1", [normalizedEmail]);
  if (existing.rowCount) throw conflict("An account already exists for that email.");

  const passwordHash = await hashPassword(password);
  const userRow = await transaction(async (client) => {
    const { rows } = await client.query(
      `insert into users (email, display_name, password_hash, auth_provider)
       values ($1, $2, $3, 'local') returning *`,
      [normalizedEmail, displayName.trim(), passwordHash],
    );
    await client.query("insert into user_settings (user_id) values ($1)", [rows[0].id]);
    return rows[0];
  });

  return session(userRow);
}

export async function login({ email, password }) {
  const { rows } = await query("select * from users where email = $1", [
    email.trim().toLowerCase(),
  ]);
  const user = rows[0];
  // Always run a comparison so a missing account and a wrong password cost the same.
  const ok = await verifyPassword(password, user?.password_hash || "scrypt$16384$8$1$00$00");
  if (!user || !ok) throw unauthorized("Email or password is incorrect.");
  return session(user);
}

export async function refresh(refreshToken) {
  const { rows } = await query(
    // rt.id is aliased: `u.*` also has an `id` and would otherwise shadow it.
    `select rt.id as token_id, rt.expires_at as token_expires_at, rt.revoked_at, u.*
       from refresh_tokens rt join users u on u.id = rt.user_id
      where rt.token_hash = $1`,
    [hashToken(String(refreshToken || ""))],
  );
  const row = rows[0];
  if (!row || row.revoked_at || new Date(row.token_expires_at) < new Date()) {
    throw unauthorized("Please sign in again.");
  }
  // Rotate: the presented token is retired as the new one is issued.
  await query("update refresh_tokens set revoked_at = now() where id = $1", [row.token_id]);
  return session(row);
}

export async function logout(refreshToken) {
  if (!refreshToken) return;
  await query(
    "update refresh_tokens set revoked_at = now() where token_hash = $1 and revoked_at is null",
    [hashToken(String(refreshToken))],
  );
}

export async function getUserById(id) {
  const { rows } = await query("select * from users where id = $1", [id]);
  return rows[0] ? publicUser(rows[0]) : null;
}

/**
 * Phase 5 seam. Called ONLY with a payload the backend verified against
 * Google's public keys — never with a client-supplied email.
 */
export async function upsertGoogleUser({ sub, email, name }) {
  const normalizedEmail = String(email).trim().toLowerCase();
  const userRow = await transaction(async (client) => {
    const { rows } = await client.query(
      `insert into users (email, display_name, auth_provider, google_sub)
            values ($1, $2, 'google', $3)
       on conflict (email) do update
            set google_sub = coalesce(users.google_sub, excluded.google_sub),
                display_name = excluded.display_name,
                updated_at = now()
       returning *`,
      [normalizedEmail, String(name || normalizedEmail.split("@")[0]), String(sub)],
    );
    await client.query("insert into user_settings (user_id) values ($1) on conflict do nothing", [
      rows[0].id,
    ]);
    return rows[0];
  });
  return session(userRow);
}

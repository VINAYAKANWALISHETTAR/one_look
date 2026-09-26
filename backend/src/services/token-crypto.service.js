/**
 * Token encryption — OAuth credentials are never stored as plaintext.
 *
 * AES-256-GCM with a random 12-byte IV per value. The stored string is
 * `v1.<iv>.<authTag>.<ciphertext>` (all base64url), which is opaque: anyone
 * reading the database sees no usable credential.
 *
 * The key comes ONLY from the backend environment (TOKEN_ENCRYPTION_KEY,
 * 32 bytes base64). It is never sent to the browser and never logged.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { config } from "../config.js";

const VERSION = "v1";
const b64 = (buf) => buf.toString("base64url");
const unb64 = (text) => Buffer.from(text, "base64url");

let cachedKey = null;

function key() {
  if (cachedKey) return cachedKey;
  const raw = config.tokenEncryptionKey;
  if (!raw) throw new Error("TOKEN_ENCRYPTION_KEY is not configured.");
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== 32) {
    throw new Error(
      "TOKEN_ENCRYPTION_KEY must be 32 bytes, base64 encoded (openssl rand -base64 32).",
    );
  }
  cachedKey = buf;
  return cachedKey;
}

export function encryptToken(plaintext) {
  if (plaintext === null || plaintext === undefined || plaintext === "") return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
  return [VERSION, b64(iv), b64(cipher.getAuthTag()), b64(ciphertext)].join(".");
}

export function decryptToken(stored) {
  if (!stored) return null;
  const [version, ivPart, tagPart, dataPart] = String(stored).split(".");
  if (version !== VERSION || !ivPart || !tagPart || !dataPart) {
    throw new Error("Stored token is not in the expected encrypted format.");
  }
  const decipher = createDecipheriv("aes-256-gcm", key(), unb64(ivPart));
  decipher.setAuthTag(unb64(tagPart));
  return Buffer.concat([decipher.update(unb64(dataPart)), decipher.final()]).toString("utf8");
}

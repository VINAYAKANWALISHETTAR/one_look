/**
 * Auth service — the single seam between the app and whatever backs accounts.
 *
 * TODAY: local-only. Nothing leaves the device, no database, no network.
 * The passcode is never stored: only a PBKDF2 hash + random salt live in
 * IndexedDB.
 *
 * LATER: when real credentials and a backend exist, only the bodies below
 * change (fetch calls to your API). No caller has to be touched.
 */

import { STORES, readValue, writeValue, remove } from "../db/indexeddb.js";

const ACCOUNT_KEY = "account";
const SESSION_KEY = "session";
const PBKDF2_ITERATIONS = 150000;

function bytesToHex(buffer) {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  return bytes;
}

async function derive(passcode, saltBytes) {
  const key = await window.crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passcode),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await window.crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: saltBytes, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    key,
    256,
  );
  return bytesToHex(bits);
}

export async function getAccount() {
  return readValue(STORES.auth, ACCOUNT_KEY);
}

export async function signUp({ name, email, passcode }) {
  const trimmedName = String(name || "").trim();
  const trimmedEmail = String(email || "")
    .trim()
    .toLowerCase();

  if (trimmedName.length < 2) throw new Error("Enter your name.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail))
    throw new Error("Enter a valid email address.");
  if (String(passcode || "").length < 6)
    throw new Error("Use a passcode of at least 6 characters.");

  const salt = window.crypto.getRandomValues(new Uint8Array(16));
  const account = {
    name: trimmedName,
    email: trimmedEmail,
    salt: bytesToHex(salt),
    hash: await derive(passcode, salt),
    createdAt: new Date().toISOString(),
  };

  await writeValue(STORES.auth, ACCOUNT_KEY, account);
  return startSession(account);
}

export async function signIn({ email, passcode }) {
  const account = await getAccount();
  if (!account) throw new Error("No account on this device yet. Create one first.");
  if (!account.hash)
    throw new Error("This account uses Google sign-in. Continue with Google instead.");

  const given = String(email || "")
    .trim()
    .toLowerCase();
  if (given && given !== account.email) throw new Error("Email or passcode is incorrect.");

  const hash = await derive(String(passcode || ""), hexToBytes(account.salt));
  if (hash !== account.hash) throw new Error("Email or passcode is incorrect.");

  return startSession(account);
}

/**
 * Google sign-in. The account record keeps provider = "google" and has no
 * passcode hash — Google is the credential. Nothing about the token is stored.
 */
export async function signInWithGoogle(profile) {
  const email = String(profile?.email || "")
    .trim()
    .toLowerCase();
  if (!email) throw new Error("Google did not share an email address.");

  const existing = await getAccount();
  const account = {
    name: profile.name || existing?.name || email.split("@")[0],
    email,
    provider: "google",
    picture: profile.picture || "",
    googleId: profile.sub || "",
    salt: existing?.email === email ? existing.salt : undefined,
    hash: existing?.email === email ? existing.hash : undefined,
    createdAt: existing?.createdAt || new Date().toISOString(),
  };

  await writeValue(STORES.auth, ACCOUNT_KEY, account);
  return startSession(account);
}

/** Used after a successful biometric assertion — no passcode required. */
export async function resumeWithBiometric() {
  const account = await getAccount();
  if (!account) throw new Error("No account on this device yet.");
  return startSession(account);
}

async function startSession(account) {
  const session = {
    email: account.email,
    name: account.name,
    provider: account.provider || "local",
    startedAt: new Date().toISOString(),
  };
  await writeValue(STORES.settings, SESSION_KEY, session);
  return session;
}

export async function getSession() {
  return readValue(STORES.settings, SESSION_KEY);
}

/** Locks the app but keeps the account (biometric / passcode re-entry). */
export async function lock() {
  await remove(STORES.settings, SESSION_KEY);
}

/** Signs out and forgets the account on this device. */
export async function signOut() {
  await remove(STORES.settings, SESSION_KEY);
}

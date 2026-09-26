/**
 * WebAuthn platform-authenticator wrapper (face / fingerprint / device unlock).
 *
 * Capability is DETECTED, never faked. If the device has no platform
 * authenticator, callers hide the biometric option and fall back to the
 * passcode. Same API path a Capacitor WebView exposes on Android.
 */

import { STORES, readValue, writeValue, remove } from "../db/indexeddb.js";

const CRED_KEY = "biometricCredential";

function toBase64Url(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function randomBytes(length = 32) {
  const bytes = new Uint8Array(length);
  window.crypto.getRandomValues(bytes);
  return bytes;
}

export function isSupported() {
  return Boolean(
    window.PublicKeyCredential &&
    window.navigator.credentials &&
    typeof window.navigator.credentials.create === "function",
  );
}

/** True only when this device actually has a built-in biometric/PIN authenticator. */
export async function isAvailable() {
  if (!isSupported()) return false;
  try {
    if (
      typeof window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable !== "function"
    ) {
      return false;
    }
    return await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

export async function isEnrolled() {
  return Boolean(await readValue(STORES.auth, CRED_KEY));
}

export async function enroll(user) {
  if (!(await isAvailable())) {
    throw new Error("This device has no face or fingerprint unlock available.");
  }

  const credential = await window.navigator.credentials.create({
    publicKey: {
      challenge: randomBytes(),
      rp: { name: "One Look", id: window.location.hostname },
      user: {
        id: randomBytes(16),
        name: user.email || "one-look-user",
        displayName: user.name || user.email || "One Look",
      },
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },
        { type: "public-key", alg: -257 },
      ],
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        userVerification: "required",
        residentKey: "preferred",
      },
      timeout: 60000,
      attestation: "none",
    },
  });

  if (!credential) throw new Error("Biometric setup was cancelled.");

  await writeValue(STORES.auth, CRED_KEY, {
    id: toBase64Url(credential.rawId),
    createdAt: new Date().toISOString(),
  });

  return true;
}

/** Prompts face/fingerprint. Resolves true only on a real successful assertion. */
export async function verify() {
  const stored = await readValue(STORES.auth, CRED_KEY);
  if (!stored) throw new Error("Biometric unlock is not set up yet.");

  const assertion = await window.navigator.credentials.get({
    publicKey: {
      challenge: randomBytes(),
      rpId: window.location.hostname,
      allowCredentials: [{ type: "public-key", id: fromBase64Url(stored.id) }],
      userVerification: "required",
      timeout: 60000,
    },
  });

  if (!assertion) throw new Error("Biometric check was cancelled.");
  return true;
}

export async function unenroll() {
  await remove(STORES.auth, CRED_KEY);
}

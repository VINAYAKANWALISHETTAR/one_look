/**
 * Google sign-in — Google Identity Services (GIS), browser side only.
 *
 * What happens here:
 *   1. The GIS script is loaded on demand (never on first paint).
 *   2. google.accounts.id returns a signed ID token (a JWT).
 *   3. We read the *unverified* profile claims (name, email, picture) purely
 *      to fill the local account record.
 *
 * Security notes:
 *   - Only the public OAuth client ID is used. No client secret, ever.
 *   - The ID token is NOT trusted as an authorisation decision: this phase has
 *     no server and no private data behind it. When the Node/Express backend
 *     lands (Phase 3), send `credential` to it and verify the signature,
 *     `aud`, `iss` and `exp` there before issuing your own session.
 *   - Gmail / Calendar scopes are deliberately not requested here. Those need
 *     the backend OAuth flow with refresh-token storage server side.
 */

import { CONFIG, isGoogleConfigured } from "../config.js";

const GIS_SRC = "https://accounts.google.com/gsi/client";
let scriptPromise = null;

export const isConfigured = isGoogleConfigured;

function loadScript() {
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${GIS_SRC}"]`);
    if (existing && window.google?.accounts?.id) return resolve();

    const script = existing || document.createElement("script");
    script.src = GIS_SRC;
    script.async = true;
    script.defer = true;
    script.addEventListener("load", () => resolve());
    script.addEventListener("error", () => {
      scriptPromise = null;
      reject(new Error("Google sign-in could not load. Check your connection."));
    });
    if (!existing) document.head.append(script);
  });
  return scriptPromise;
}

/** Reads the claims out of an ID token without trusting them (see notes above). */
function readClaims(credential) {
  const payload = String(credential || "").split(".")[1];
  if (!payload) throw new Error("Google returned an unreadable response.");
  const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
  const claims = JSON.parse(decodeURIComponent(escape(json)));
  if (!claims.email) throw new Error("Google did not share an email address.");
  return {
    email: String(claims.email).toLowerCase(),
    name: claims.name || claims.given_name || String(claims.email).split("@")[0],
    picture: claims.picture || "",
    sub: claims.sub || "",
  };
}

/**
 * Opens the Google account chooser and resolves with the profile.
 * Rejects with a readable message when unavailable or dismissed.
 */
export async function signIn() {
  if (!isGoogleConfigured()) {
    throw new Error("Google sign-in is not configured yet. Add your client ID in js/config.js.");
  }

  await loadScript();
  const id = window.google?.accounts?.id;
  if (!id) throw new Error("Google sign-in is unavailable in this browser.");

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      fn(value);
    };

    try {
      id.initialize({
        client_id: CONFIG.googleClientId,
        auto_select: false,
        cancel_on_tap_outside: true,
        callback: (response) => {
          try {
            finish(resolve, readClaims(response?.credential));
          } catch (err) {
            finish(reject, err);
          }
        },
      });

      id.prompt((notification) => {
        if (notification?.isNotDisplayed?.() || notification?.isSkippedMoment?.()) {
          finish(
            reject,
            new Error(
              "Google didn't open a sign-in prompt. Check that this origin is allowed for your client ID.",
            ),
          );
        }
      });
    } catch (err) {
      finish(reject, new Error(err?.message || "Google sign-in failed."));
    }
  });
}

/** Clears any cached Google session hint on this device. */
export function signOut() {
  try {
    window.google?.accounts?.id?.disableAutoSelect?.();
  } catch {
    /* nothing to clear */
  }
}

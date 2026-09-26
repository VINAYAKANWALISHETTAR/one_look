/**
 * Service-worker registration + install prompt.
 *
 * Registration is deliberately defensive:
 *  - never inside an embedded/preview iframe (a cached shell there would serve
 *    stale HTML back to the editor preview),
 *  - never on Lovable preview hostnames,
 *  - never when the page is opened with ?sw=off (kill switch),
 *  - and any failure is swallowed: the app must work with no service worker.
 *
 * NOTE on icons: /app/assets/icons/icon-192.png and icon-512.png are TEMPORARY
 * development placeholders, not final branding. Replace them with real artwork
 * before shipping to a store or a wider audience.
 */

const SW_URL = "/service-worker.js";

let deferredPrompt = null;
let installAvailable = false;

function isEmbedded() {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

function isPreviewHost() {
  const h = window.location.hostname;
  return (
    h.startsWith("id-preview--") ||
    h.startsWith("preview--") ||
    h === "lovableproject.com" ||
    h.endsWith(".lovableproject.com") ||
    h === "lovableproject-dev.com" ||
    h.endsWith(".lovableproject-dev.com") ||
    h === "beta.lovable.dev" ||
    h.endsWith(".beta.lovable.dev")
  );
}

export function isSupported() {
  return "serviceWorker" in navigator;
}

function refused() {
  const off =
    new URLSearchParams(window.location.search).has("sw") &&
    new URLSearchParams(window.location.search).get("sw") === "off";
  return off || isEmbedded() || isPreviewHost();
}

async function unregisterAll() {
  try {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.allSettled(
      regs
        .filter((r) => (r.active || r.waiting || r.installing)?.scriptURL?.endsWith(SW_URL))
        .map((r) => r.unregister()),
    );
  } catch {
    /* nothing we can do, and nothing that should break the app */
  }
}

/** Registers the service worker when it is safe to do so. Never throws. */
export async function registerServiceWorker() {
  if (!isSupported()) return { registered: false, reason: "unsupported" };
  if (refused()) {
    await unregisterAll();
    return { registered: false, reason: "context" };
  }
  try {
    const registration = await navigator.serviceWorker.register(SW_URL, { scope: "/" });
    return { registered: true, registration };
  } catch (error) {
    console.warn("[One Look] service worker not registered:", error?.message || error);
    return { registered: false, reason: "error" };
  }
}

/** True once the app is actually being served by a service worker. */
export function isOfflineReady() {
  return Boolean(isSupported() && navigator.serviceWorker.controller);
}

export function isStandalone() {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    window.navigator.standalone === true
  );
}

/* ---------- Install prompt ---------- */
window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredPrompt = event;
  installAvailable = true;
});

window.addEventListener("appinstalled", () => {
  deferredPrompt = null;
  installAvailable = false;
});

/** Only true when the browser really offered an install prompt. */
export function canInstall() {
  return installAvailable && !isStandalone();
}

/** Shows the browser's own install dialog. Returns "accepted"|"dismissed"|"unavailable". */
export async function promptInstall() {
  if (!deferredPrompt) return "unavailable";
  try {
    await deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    deferredPrompt = null;
    installAvailable = false;
    return choice?.outcome === "accepted" ? "accepted" : "dismissed";
  } catch {
    return "unavailable";
  }
}

/* ---------- Status for the More page ---------- */
export function getState() {
  return {
    supported: isSupported(),
    offlineReady: isOfflineReady(),
    standalone: isStandalone(),
    canPrompt: canInstall(),
    refused: isSupported() && refused(),
  };
}

export function statusLabel(state = getState()) {
  if (!state.supported) return "This browser cannot cache the app offline";
  if (state.refused) return "Offline mode is disabled in preview — works on the live site";
  if (state.offlineReady) return "Ready — your tasks and notes open without a connection";
  return "Preparing offline access…";
}

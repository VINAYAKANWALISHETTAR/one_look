/**
 * One Look — application-shell service worker.
 *
 * Scope: "/" (this file is served from the site root).
 *
 * What it does
 *  - Precaches the app shell: the HTML document, CSS, ES modules, local icons.
 *  - Navigations: network-first with a cached-shell fallback, so a new deploy is
 *    picked up as soon as the network answers and the app still opens offline.
 *  - Local CSS/JS/icons: stale-while-revalidate (fast paint, silent refresh).
 *  - Everything else (any cross-origin request: weather, geocoding, Google
 *    sign-in) goes straight to the network and is NEVER cached.
 *
 * What it deliberately does NOT do
 *  - No caching of POST/PUT/etc, no caching of cross-origin API responses, no
 *    caching of anything auth-related. Passcodes/hashes live in IndexedDB only
 *    and never pass through here.
 *  - No scheduled/background notifications. Reminders are foreground-only and
 *    stay owned by the page (js/modules/reminders.js).
 */

const VERSION = "v6.0.0";
const SHELL_CACHE = `onelook-shell-${VERSION}`;
const ASSET_CACHE = `onelook-assets-${VERSION}`;
const OWNED = [SHELL_CACHE, ASSET_CACHE];

const SHELL_URL = "/";

const PRECACHE = [
  SHELL_URL,
  "/manifest.json",
  "/favicon.png",
  "/app/css/style.css",
  "/app/css/components.css",
  "/app/css/responsive.css",
  "/app/js/app.js",
  "/app/js/config.js",
  "/app/js/router.js",
  "/app/js/db/indexeddb.js",
  "/app/js/modules/auth.js",
  "/app/js/modules/biometric.js",
  "/app/js/modules/connectivity.js",
  "/app/js/modules/dashboard.js",
  "/app/js/modules/format.js",
  "/app/js/modules/install.js",
  "/app/js/modules/notes.js",
  "/app/js/modules/mail.js",
  "/app/js/modules/notifications.js",
  "/app/js/modules/reminders.js",
  "/app/js/modules/search.js",
  "/app/js/modules/tasks.js",
  "/app/js/modules/ui.js",
  "/app/js/modules/weather.js",
  "/app/js/services/auth-service.js",
  "/app/js/services/api-service.js",
  "/app/js/services/google-auth-service.js",
  "/app/js/services/mail-service.js",
  "/app/js/services/sync-service.js",
  "/app/js/services/weather-service.js",
  "/app/assets/icons/icon-192.png",
  "/app/assets/icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // Individually, so one missing file can never abort the whole install.
      await Promise.allSettled(PRECACHE.map((url) => cache.add(new Request(url, { cache: "reload" }))));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      const outdated = names.filter((name) => name.startsWith("onelook-") && !OWNED.includes(name));
      await Promise.allSettled(outdated.map((name) => caches.delete(name)));
      await self.clients.claim();
    })(),
  );
});

/** Allows the page to trigger an immediate update. */
self.addEventListener("message", (event) => {
  if (event.data === "skip-waiting") self.skipWaiting();
});

function isLocalAsset(url) {
  return (
    url.pathname.startsWith("/app/css/") ||
    url.pathname.startsWith("/app/js/") ||
    url.pathname.startsWith("/app/assets/") ||
    url.pathname === "/favicon.png" ||
    url.pathname === "/manifest.json"
  );
}

async function networkFirstShell(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const response = await fetch(request);
    if (response && response.ok) cache.put(SHELL_URL, response.clone());
    return response;
  } catch {
    const cached = await cache.match(SHELL_URL);
    if (cached) return cached;
    return new Response("<h1>One Look is offline</h1><p>Open the app once while online, then it works offline.</p>", {
      status: 503,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(ASSET_CACHE);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (response && response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);
  if (cached) return cached;
  const fresh = await network;
  if (fresh) return fresh;
  const shell = await caches.open(SHELL_CACHE);
  const fallback = await shell.match(request);
  if (fallback) return fallback;
  return new Response("", { status: 504 });
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return; // never cache mutations
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // never cache external APIs

  if (request.mode === "navigate") {
    event.respondWith(networkFirstShell(request));
    return;
  }

  if (isLocalAsset(url)) {
    event.respondWith(staleWhileRevalidate(request));
  }
});

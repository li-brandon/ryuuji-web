// Ryuuji service worker: lets the installed app open offline. Library data already lives in
// IndexedDB, so only the app shell (page HTML plus the JS/CSS it references) is cached here.
//
// - Navigations: network first; offline, the cached copy of that page, else the cached "/" shell.
// - /_next/static/*: cache first (file names are content-hashed, so entries never go stale).
// - /api/* and everything else: not intercepted and never cached. /api/session sets the session
//   cookie and /api/tmdb is gated by it, so their responses must not outlive the request.
//
// Bump VERSION to drop every cache on the next activation. lib/sw.test.ts runs this file in a vm.

const VERSION = "v1";
const SHELL_CACHE = `ryuuji-shell-${VERSION}`;
const STATIC_CACHE = `ryuuji-static-${VERSION}`;
const SHELL_ROUTES = ["/", "/library", "/seasonal", "/history", "/stats", "/settings", "/about"];
const MAX_STATIC_ENTRIES = 300;

/**
 * How to handle a request: "navigate" (network first, offline shell), "static" (cache first),
 * or null (let the browser handle it, uncached).
 */
function swRoute(request, origin) {
  if (request.method !== "GET") return null;
  const url = new URL(request.url);
  if (url.origin !== origin) return null;
  if (url.pathname === "/api" || url.pathname.startsWith("/api/")) return null;
  if (request.mode === "navigate") return "navigate";
  if (url.pathname.startsWith("/_next/static/")) return "static";
  return null;
}

/** Same-origin /_next/static/ asset paths referenced by a page's HTML (including its RSC payload). */
function staticAssetsIn(html) {
  return [...new Set(html.match(/\/_next\/static\/[^"'\s\\)<>]+/g) ?? [])];
}

/** Whether a response is a complete, same-origin, non-redirected 200 worth caching. */
function cacheable(response) {
  return response.ok && response.status === 200 && response.type === "basic" && !response.redirected;
}

async function precacheShell() {
  const shell = await caches.open(SHELL_CACHE);
  const assets = new Set();
  await Promise.all(
    SHELL_ROUTES.map(async (path) => {
      const response = await fetch(path, { cache: "no-store", credentials: "same-origin" });
      if (!cacheable(response)) throw new Error(`Precache failed for ${path}: HTTP ${response.status}`);
      for (const asset of staticAssetsIn(await response.clone().text())) assets.add(asset);
      await shell.put(path, response);
    }),
  );
  await (await caches.open(STATIC_CACHE)).addAll([...assets]);
}

async function trimStaticCache() {
  const cache = await caches.open(STATIC_CACHE);
  const keys = await cache.keys();
  // Keys come back in insertion order, so the oldest go first.
  await Promise.all(keys.slice(0, Math.max(0, keys.length - MAX_STATIC_ENTRIES)).map((key) => cache.delete(key)));
}

async function networkFirstNavigation(request) {
  const shell = await caches.open(SHELL_CACHE);
  try {
    const response = await fetch(request);
    if (cacheable(response)) await shell.put(new URL(request.url).pathname, response.clone());
    return response;
  } catch (error) {
    const cached = (await shell.match(new URL(request.url).pathname)) ?? (await shell.match("/"));
    if (cached) return cached;
    throw error;
  }
}

async function cacheFirstStatic(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (cacheable(response)) await cache.put(request, response.clone());
  return response;
}

self.addEventListener("install", (event) => {
  event.waitUntil(precacheShell().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([SHELL_CACHE, STATIC_CACHE]);
      const names = await caches.keys();
      await Promise.all(names.filter((name) => name.startsWith("ryuuji-") && !keep.has(name)).map((name) => caches.delete(name)));
      await trimStaticCache();
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const route = swRoute(event.request, self.location.origin);
  if (route === "navigate") event.respondWith(networkFirstNavigation(event.request));
  else if (route === "static") event.respondWith(cacheFirstStatic(event.request));
});

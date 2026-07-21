/**
 * Finchippay Service Worker
 *
 * Caching strategies per issue #91:
 *  - /_next/static/       Cache-first (hash-busted URLs, indefinite)
 *  - API transaction list  Stale-while-revalidate (60 s TTL)
 *  - API account balances  Network-first with cache fallback (30 s TTL)
 *  - Horizon data          Cache-first (5 min TTL)
 *  - App shell (pages)     Network-first with cache fallback
 *
 * Also handles push notifications for incoming payments.
 */

const CACHE_VERSION = "v3";
const PRECACHE = `finchippay-precache-${CACHE_VERSION}`;
const STATIC_ASSETS = `finchippay-static-${CACHE_VERSION}`;
const API_CACHE = `finchippay-api-${CACHE_VERSION}`;
const HORIZON_CACHE = `finchippay-horizon-${CACHE_VERSION}`;

// ─── TTL constants (ms) ─────────────────────────────────────────────────────

const API_TTL_MS = 60_000;          // 60 s — transaction list
const BALANCE_TTL_MS = 30_000;      // 30 s — account balances
const HORIZON_TTL_MS = 300_000;     // 5 min — Horizon data

// ─── App shell pages to precache ────────────────────────────────────────────

const APP_SHELL_URLS = [
  "/",
  "/dashboard",
  "/transactions",
  "/contacts",
  "/settings",
  "/manifest.json",
  "/icon-192.png",
  "/icon-512.png",
];

// ─── Hosts whose GET responses we cache at runtime ──────────────────────────

const RUNTIME_CACHE_HOSTS = new Set([
  self.location.hostname,
  "localhost",
  "127.0.0.1",
  "horizon-testnet.stellar.org",
  "horizon.stellar.org",
  "api.coingecko.com",
]);

// ─── Helpers ────────────────────────────────────────────────────────────────

function isCacheable(response) {
  return response && response.ok && ["basic", "cors"].includes(response.type);
}

/**
 * Returns the appropriate cache name for a request URL.
 */
function resolveCache(url) {
  const pathname = url.pathname;

  // Next.js static assets are hash-busted — cache indefinitely
  if (pathname.startsWith("/_next/static/")) return STATIC_ASSETS;

  // Horizon API calls
  if (url.hostname.includes("horizon")) return HORIZON_CACHE;

  // Our own backend API
  if (
    pathname.startsWith("/api/") ||
    url.hostname === self.location.hostname
  ) {
    return API_CACHE;
  }

  // App shell pages
  return PRECACHE;
}

/**
 * Returns the TTL (ms) for a given request URL.  Returns Infinity for
 * hash-busted static assets and 0 for no-TTL (freshness by revalidation only).
 */
function ttlFor(url) {
  const pathname = url.pathname;

  // Hash-busted Next.js assets — cache forever
  if (pathname.startsWith("/_next/static/")) return Infinity;

  // Horizon data — 5 min
  if (url.hostname.includes("horizon")) return HORIZON_TTL_MS;

  // Balance-related API calls — 30 s
  if (
    pathname.includes("/accounts/") ||
    pathname.includes("/balances") ||
    pathname.includes("/resolve/")
  ) {
    return BALANCE_TTL_MS;
  }

  // Other API calls (transaction list, etc.) — 60 s
  if (
    pathname.startsWith("/api/") ||
    url.hostname === self.location.hostname
  ) {
    return API_TTL_MS;
  }

  return 0;
}

/**
 * Store a response in cache with a `sw-saved-at` header so TTL logic can
 * check staleness later.
 */
async function putWithTimestamp(cache, request, response) {
  const clone = response.clone();
  const headers = new Headers(clone.headers);
  headers.set("sw-saved-at", Date.now().toString());

  const timedResponse = new Response(clone.body, {
    status: clone.status,
    statusText: clone.statusText,
    headers,
  });

  await cache.put(request, timedResponse);
}

/**
 * Returns true if the cached response is older than its TTL.
 */
async function isStale(cache, request) {
  const match = await cache.match(request);
  if (!match) return true;

  const savedHeader = match.headers.get("sw-saved-at");
  if (!savedHeader) return true;

  const savedAt = Number(savedHeader);
  const ttl = ttlFor(new URL(request.url));
  if (ttl === Infinity) return false;
  if (ttl === 0) return true;

  return Date.now() - savedAt > ttl;
}

// ─── Caching strategies ─────────────────────────────────────────────────────

/**
 * Cache-first (with TTL check):
 * 1. If cached + fresh  → return cached
 * 2. Otherwise           → fetch, cache, return fresh
 *
 * Used for: Next.js static assets, Horizon data
 */
async function cacheFirst(request) {
  const cache = await caches.open(resolveCache(new URL(request.url)));

  const cached = await cache.match(request);
  if (cached && !(await isStale(cache, request))) {
    return cached;
  }

  try {
    const response = await fetch(request);
    if (isCacheable(response)) {
      await putWithTimestamp(cache, request, response.clone());
    }
    return response;
  } catch {
    // Offline — return cached even if stale
    if (cached) return cached;
    throw new Error("Network unavailable and no cached response");
  }
}

/**
 * Network-first with cache fallback:
 * 1. Try network
 * 2. On failure → serve cached (even if stale)
 * 3. On success → cache for next offline use
 *
 * Used for: app shell pages, account balances
 */
async function networkFirst(request) {
  const cache = await caches.open(resolveCache(new URL(request.url)));

  try {
    const response = await fetch(request);
    if (isCacheable(response)) {
      await putWithTimestamp(cache, request, response.clone());
    }
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw new Error("Network unavailable and no cached response");
  }
}

/**
 * Stale-while-revalidate:
 * 1. Return cached immediately (if available)
 * 2. Revalidate in background via network
 * 3. Update cache for next request
 *
 * Used for: API transaction list
 */
async function staleWhileRevalidate(request) {
  const cache = await caches.open(resolveCache(new URL(request.url)));
  const cached = await cache.match(request);

  // Fire-and-forget background revalidation
  fetch(request)
    .then(async (response) => {
      if (isCacheable(response)) {
        await putWithTimestamp(cache, request, response.clone());
      }
    })
    .catch(() => {
      // Silently fail — we already returned cached data
    });

  if (cached) {
    return cached;
  }

  // No cached data — must wait for network
  const response = await fetch(request);
  if (isCacheable(response)) {
    await putWithTimestamp(cache, request, response.clone());
  }
  return response;
}

// ─── Navigation handling ────────────────────────────────────────────────────

async function handleNavigation(request) {
  const cache = await caches.open(PRECACHE);

  try {
    const response = await fetch(request);
    if (isCacheable(response)) {
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    return (
      (await cache.match(request)) ||
      (await cache.match("/")) ||
      Response.error()
    );
  }
}

// ─── Install ────────────────────────────────────────────────────────────────

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(PRECACHE).then((cache) => cache.addAll(APP_SHELL_URLS))
  );
  self.skipWaiting();
});

// ─── Activate ───────────────────────────────────────────────────────────────

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (key) =>
                key.startsWith("finchippay-") &&
                ![PRECACHE, STATIC_ASSETS, API_CACHE, HORIZON_CACHE].includes(
                  key
                )
            )
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

// ─── Fetch ──────────────────────────────────────────────────────────────────

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Navigation requests — HTML pages
  if (request.mode === "navigate") {
    event.respondWith(handleNavigation(request));
    return;
  }

  // Non-GET requests pass through to network
  if (request.method !== "GET") return;

  // Skip non-http(s) URLs
  if (!["http:", "https:"].includes(url.protocol)) return;

  // ── Next.js static assets — cache-first (hash-busted) ──────────────────
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // ── Horizon data — cache-first ─────────────────────────────────────────
  if (
    url.hostname === "horizon-testnet.stellar.org" ||
    url.hostname === "horizon.stellar.org"
  ) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // ── Backend API — strategy depends on endpoint ────────────────────────
  if (
    url.hostname === self.location.hostname &&
    url.pathname.startsWith("/api/")
  ) {
    // Account balances → network-first with cache fallback (30 s TTL)
    if (
      url.pathname.includes("/accounts/") ||
      url.pathname.includes("/balances") ||
      url.pathname.includes("/resolve/")
    ) {
      event.respondWith(networkFirst(request));
      return;
    }
    // Transaction lists & other API → stale-while-revalidate (60 s TTL)
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  // ── Other same-origin / runtime-cacheable — network-first ──────────────
  if (RUNTIME_CACHE_HOSTS.has(url.hostname)) {
    event.respondWith(networkFirst(request));
  }
});

// ─── Push notifications ─────────────────────────────────────────────────────

self.addEventListener("push", (event) => {
  let data = { title: "Finchippay", body: "You have a new notification." };

  if (event.data) {
    try {
      data = event.data.json();
    } catch {
      data = { title: "Finchippay", body: event.data.text() };
    }
  }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      vibrate: [200, 100, 200],
      data: {
        url: data.url || "/dashboard",
      },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if ("focus" in client) return client.focus();
        }
        if (clients.openWindow) {
          return clients.openWindow(
            event.notification.data?.url || "/dashboard"
          );
        }
      })
  );
});

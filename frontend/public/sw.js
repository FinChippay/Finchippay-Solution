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

// ─── Background Sync — offline transaction queue ─────────────────────────────
//
// When the "submit-payments" sync tag fires the SW reads every transaction
// with status "queued" or "failed" from IndexedDB and POSTs its signed XDR to
// Horizon.  On success the record is deleted; on failure the status is updated
// to "failed" so the main thread can surface the error.
//
// The same DB_NAME / TX_STORE constants must match offlineQueue.ts.

const QUEUE_DB_NAME = "finchippay-offline-queue";
const QUEUE_DB_VERSION = 2;
const QUEUE_TX_STORE = "transactions";

/** Open (and upgrade if needed) the offline-queue IndexedDB. */
function openQueueDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(QUEUE_DB_NAME, QUEUE_DB_VERSION);

    req.onupgradeneeded = (event) => {
      const db = req.result;
      const oldVersion = event.oldVersion;

      if (oldVersion < 1) {
        if (!db.objectStoreNames.contains("actions")) {
          db.createObjectStore("actions", { keyPath: "id", autoIncrement: true });
        }
      }

      if (oldVersion < 2) {
        if (!db.objectStoreNames.contains(QUEUE_TX_STORE)) {
          const store = db.createObjectStore(QUEUE_TX_STORE, { keyPath: "id" });
          store.createIndex("status", "status", { unique: false });
          store.createIndex("createdAt", "createdAt", { unique: false });
        }
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Retrieve all transactions that should be submitted. */
async function getPendingTransactions(db) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(QUEUE_TX_STORE, "readonly");
    const req = tx.objectStore(QUEUE_TX_STORE).getAll();
    req.onsuccess = () => {
      const all = req.result || [];
      resolve(all.filter((t) => t.status === "queued" || t.status === "failed"));
    };
    req.onerror = () => reject(req.error);
  });
}

/** Persist a changed record back to IndexedDB. */
function putTransaction(db, record) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(QUEUE_TX_STORE, "readwrite");
    tx.objectStore(QUEUE_TX_STORE).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Remove a successfully submitted transaction from IndexedDB. */
function deleteTransaction(db, id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(QUEUE_TX_STORE, "readwrite");
    tx.objectStore(QUEUE_TX_STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Derive the Horizon base URL from the SW location (falls back to testnet). */
function getHorizonUrl() {
  // Production SW will be served from the app origin; fall back to testnet.
  try {
    const origin = self.location.origin;
    // If the app exposes a custom horizon endpoint via an env-baked constant,
    // it should be injected here.  For now we always use the public testnet
    // endpoint for the SW context (offline queue is a testnet-first feature).
    return "https://horizon-testnet.stellar.org";
  } catch {
    return "https://horizon-testnet.stellar.org";
  }
}

/**
 * Core submission loop — called by the "sync" event and also re-exported via
 * postMessage for manual "Retry" triggers from the OfflineBanner UI.
 */
async function submitQueuedPayments() {
  let db;
  try {
    db = await openQueueDB();
  } catch {
    // IndexedDB unavailable (e.g. private browsing with cookie blocking).
    return;
  }

  const pending = await getPendingTransactions(db);
  const horizonUrl = getHorizonUrl();
  const results = [];

  for (const record of pending) {
    // Mark in-flight so the UI can show a spinner.
    await putTransaction(db, { ...record, status: "submitting" });

    try {
      const body = new URLSearchParams({ tx: record.signedXDR });
      const response = await fetch(`${horizonUrl}/transactions`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });

      if (!response.ok) {
        let detail = response.statusText;
        try {
          const json = await response.json();
          detail =
            json?.extras?.result_codes?.transaction ?? json?.detail ?? detail;
        } catch { /* ignore */ }
        throw new Error(`Horizon ${response.status}: ${detail}`);
      }

      // ✓ Success — remove from queue.
      await deleteTransaction(db, record.id);
      results.push({ destination: record.destination, amount: record.amount, asset: record.asset, success: true });
    } catch (err) {
      // ✗ Failure — persist error for the next retry.
      await putTransaction(db, {
        ...record,
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
        attempts: (record.attempts || 0) + 1,
      });
      results.push({ destination: record.destination, amount: record.amount, asset: record.asset, success: false, error: err instanceof Error ? err.message : String(err) });
    }
  }

  db.close();

  // Notify all open tabs so they can refresh the queue badge / banner.
  const clientList = await self.clients.matchAll({ type: "window" });
  for (const client of clientList) {
    client.postMessage({ type: "QUEUE_PROCESSED", results });
  }
}

self.addEventListener("sync", (event) => {
  if (event.tag === "submit-payments") {
    event.waitUntil(submitQueuedPayments());
  }
});

/**
 * Allow the main thread to trigger a manual retry via postMessage
 * (used by the "Retry" button in OfflineBanner when BG Sync is unsupported).
 */
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "RETRY_QUEUE") {
    event.waitUntil(submitQueuedPayments());
  }
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const targetUrl = event.notification.data?.url || "/dashboard";
  let targetPath = targetUrl;
  try {
    targetPath = new URL(targetUrl, self.location.origin).pathname;
  } catch {
    targetPath = "/dashboard";
  }

  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then(async (clientList) => {
        // Prefer a window already showing the target page.
        for (const client of clientList) {
          try {
            if (
              new URL(client.url).pathname === targetPath &&
              "focus" in client
            ) {
              return client.focus();
            }
          } catch {
            // Unparseable client URL — fall through to the generic handling.
          }
        }

        // Otherwise reuse an open window, but navigate it to the target first:
        // focusing alone leaves the user on whatever page they already had
        // open, which is not where the notification pointed.
        for (const client of clientList) {
          if ("focus" in client) {
            const focused = await client.focus();
            if ("navigate" in client) {
              try {
                return await client.navigate(targetUrl);
              } catch {
                // navigate() rejects for cross-origin or unloaded clients; a
                // focused window still beats doing nothing.
                return focused;
              }
            }
            return focused;
          }
        }

        if (clients.openWindow) {
          return clients.openWindow(targetUrl);
        }
      })
  );
});

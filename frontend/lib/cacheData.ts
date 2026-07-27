/**
 * lib/cacheData.ts
 *
 * Caches the last successful API responses in IndexedDB so they can be
 * displayed when the user is offline.  Each entry is stored with a timestamp
 * so components can show "Last updated X minutes ago."
 *
 * Usage
 * -----
 *   // After a successful API call:
 *   await cacheData.set("payments", data);
 *
 *   // When offline, read from cache:
 *   const entry = await cacheData.get<Payment[]>("payments");
 *   if (entry) {
 *     console.log(entry.data);        // the cached value
 *     console.log(entry.cachedAt);    // Date object
 *     console.log(entry.ageLabel);    // "5 minutes ago"
 *   }
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CacheEntry<T = unknown> {
  /** The cache key / resource identifier */
  key: string;
  /** The cached value */
  data: T;
  /** ISO timestamp of when this entry was written */
  cachedAt: string;
  /** Optional ETag / version tag for future cache-busting */
  etag?: string;
}

export interface ResolvedCacheEntry<T = unknown> extends CacheEntry<T> {
  /** Parsed Date for easy comparison */
  cachedAtDate: Date;
  /** Human-readable age string, e.g. "3 minutes ago" */
  ageLabel: string;
}

// ─── IndexedDB helpers ───────────────────────────────────────────────────────

const DB_NAME = "finchippay-cache";
const DB_VERSION = 1;
const STORE = "responses";

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is not available"));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "key" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// ─── Age label helper ─────────────────────────────────────────────────────────

function buildAgeLabel(cachedAt: Date): string {
  const diffMs = Date.now() - cachedAt.getTime();

  if (diffMs < 60_000) {
    const secs = Math.floor(diffMs / 1000);
    return secs <= 5 ? "just now" : `${secs} seconds ago`;
  }

  if (diffMs < 3_600_000) {
    const mins = Math.floor(diffMs / 60_000);
    return mins === 1 ? "1 minute ago" : `${mins} minutes ago`;
  }

  if (diffMs < 86_400_000) {
    const hrs = Math.floor(diffMs / 3_600_000);
    return hrs === 1 ? "1 hour ago" : `${hrs} hours ago`;
  }

  const days = Math.floor(diffMs / 86_400_000);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

function buildResolved<T>(entry: CacheEntry<T>): ResolvedCacheEntry<T> {
  const cachedAtDate = new Date(entry.cachedAt);
  return {
    ...entry,
    cachedAtDate,
    ageLabel: buildAgeLabel(cachedAtDate),
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Write (or overwrite) a cache entry for the given key.
 */
export async function set<T = unknown>(
  key: string,
  data: T,
  etag?: string
): Promise<void> {
  try {
    const db = await openDB();
    const entry: CacheEntry<T> = {
      key,
      data,
      cachedAt: new Date().toISOString(),
      ...(etag ? { etag } : {}),
    };

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const req = tx.objectStore(STORE).put(entry);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => db.close();
    });
  } catch {
    // Non-fatal — silently skip caching if IndexedDB is unavailable
  }
}

/**
 * Read a cache entry for the given key.
 * Returns `null` if no entry exists or if IndexedDB is unavailable.
 */
export async function get<T = unknown>(
  key: string
): Promise<ResolvedCacheEntry<T> | null> {
  try {
    const db = await openDB();
    return new Promise<ResolvedCacheEntry<T> | null>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => {
        if (req.result) {
          resolve(buildResolved(req.result as CacheEntry<T>));
        } else {
          resolve(null);
        }
      };
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => db.close();
    });
  } catch {
    return null;
  }
}

/**
 * Remove a specific cache entry by key.
 */
export async function remove(key: string): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const req = tx.objectStore(STORE).delete(key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => db.close();
    });
  } catch {
    // Silently ignore
  }
}

/**
 * Remove all cache entries.
 */
export async function clear(): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const req = tx.objectStore(STORE).clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => db.close();
    });
  } catch {
    // Silently ignore
  }
}

/**
 * Higher-order helper: fetch data from `fetcher`, write it to the cache,
 * and return it.  If the fetch throws and `fallback` is provided, return the
 * cached entry instead.
 *
 * @param key       Cache key
 * @param fetcher   Async function returning fresh data
 * @param fallback  When true, a network error returns stale data if available
 */
export async function fetchWithCache<T>(
  key: string,
  fetcher: () => Promise<T>,
  fallback = true
): Promise<{ data: T; fromCache: boolean; entry: ResolvedCacheEntry<T> | null }> {
  try {
    const data = await fetcher();
    await set(key, data);
    return { data, fromCache: false, entry: null };
  } catch (err) {
    if (!fallback) throw err;

    const cached = await get<T>(key);
    if (cached) {
      return { data: cached.data, fromCache: true, entry: cached };
    }
    throw err;
  }
}

/**
 * Expose the age label builder so components can refresh the label on a timer
 * without re-reading IndexedDB.
 */
export { buildAgeLabel };

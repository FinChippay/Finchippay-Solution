/**
 * lib/transactionSearchIndex.ts
 * IndexedDB utilities for persisting transaction search index
 *
 * Lifecycle policies (bounded + invalidatable):
 * - MAX_HASHES_PER_ENTRY: cap the number of payment hashes stored per token entry.
 * - MAX_INDEX_ENTRIES: cap the total number of token entries, evicting the
 *   least-recently-used entries first (Map insertion order is refreshed on read
 *   so eviction approximates LRU).
 * - invalidate(): explicitly drop hashes that no longer exist so the index
 *   can't go stale when payments are deleted/replaced.
 */

import { logger } from "@/lib/logger";
import { PaymentRecord } from "./stellar";

const DB_NAME = "FinChippayDB";
const DB_VERSION = 1;
const STORE_NAME = "transactionIndex";

/** Max number of payment hashes kept per token entry. */
export const MAX_HASHES_PER_ENTRY = 100;
/** Max number of token entries kept in the index (LRU eviction beyond this). */
export const MAX_INDEX_ENTRIES = 2000;

interface TransactionIndexMetadata {
  key: "metadata";
  lastIndexed: number;
  transactionCount: number;
}

/**
 * Initialize IndexedDB database
 */
function getDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined") {
      reject(new Error("IndexedDB not available"));
      return;
    }

    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
  });
}

/**
 * Cap each token entry to at most `maxPerEntry` hashes, keeping the newest
 * entries at the tail of the array (index insertion order is oldest→newest).
 * Returns a new Map; the input is not mutated.
 */
export function capHashesPerEntry(
  index: Map<string, string[]>,
  maxPerEntry: number = MAX_HASHES_PER_ENTRY
): Map<string, string[]> {
  const capped = new Map<string, string[]>();
  for (const [token, hashes] of index.entries()) {
    capped.set(token, hashes.slice(0, maxPerEntry));
  }
  return capped;
}

/**
 * Cap the total number of token entries to `maxEntries`, dropping the
 * least-recently-used entries first. Because Map preserves insertion order and
 * `loadIndexedDB` re-inserts entries on read (moving them to the tail), the
 * head of the Map approximates the LRU set. Returns a new Map; input not mutated.
 */
export function evictOverflow(
  index: Map<string, string[]>,
  maxEntries: number = MAX_INDEX_ENTRIES
): Map<string, string[]> {
  if (index.size <= maxEntries) {
    return new Map(index);
  }
  const result = new Map<string, string[]>();
  let excess = index.size - maxEntries;
  for (const [token, hashes] of index.entries()) {
    if (excess > 0) {
      // evict this (older) entry
      excess -= 1;
      continue;
    }
    result.set(token, hashes);
  }
  return result;
}

/**
 * Remove the given hashes from every entry, dropping entries that become empty.
 * Returns a new Map; input not mutated.
 */
export function removeHashesFromIndex(
  index: Map<string, string[]>,
  hashes: string[]
): Map<string, string[]> {
  if (hashes.length === 0) {
    return new Map(index);
  }
  const toRemove = new Set(hashes);
  const result = new Map<string, string[]>();
  for (const [token, hashesList] of index.entries()) {
    const remaining = hashesList.filter((h) => !toRemove.has(h));
    if (remaining.length > 0) {
      result.set(token, remaining);
    }
  }
  return result;
}

/**
 * Build inverted index from transactions
 */
export function buildIndex(payments: PaymentRecord[]): Map<string, string[]> {
  const index = new Map<string, string[]>();

  for (const payment of payments) {
    const tokens = new Set<string>();

    // Tokenize memo
    if (payment.memo) {
      payment.memo
        .toLowerCase()
        .split(/\s+/)
        .forEach((t) => tokens.add(t));
    }

    // Add address tokens
    if (payment.type === "payment") {
      payment.from
        .toLowerCase()
        .split(/(?=G)/)
        .filter((t) => t.length > 0)
        .forEach((t) => tokens.add(t));

      payment.to
        .toLowerCase()
        .split(/(?=G)/)
        .filter((t) => t.length > 0)
        .forEach((t) => tokens.add(t));
    }

    // Add hash prefix tokens
    for (let i = 3; i <= payment.hash.length; i += 3) {
      tokens.add(payment.hash.substring(0, i).toLowerCase());
    }

    // Store in index (bounded per entry)
    for (const token of tokens) {
      if (!index.has(token)) {
        index.set(token, []);
      }
      const hashes = index.get(token)!;
      if (!hashes.includes(payment.hash)) {
        hashes.push(payment.hash);
      }
    }
  }

  return capHashesPerEntry(index);
}

/**
 * Load the current index from IndexedDB into a Map.
 * Re-inserting entries on read refreshes Map order so eviction approximates LRU.
 */
export async function loadIndexedDB(): Promise<Map<string, string[]> | null> {
  try {
    const db = await getDB();
    const tx = db.transaction([STORE_NAME], "readonly");
    const store = tx.objectStore(STORE_NAME);

    const index = new Map<string, string[]>();

    return new Promise((resolve, reject) => {
      const cursorReq = store.openCursor();

      cursorReq.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result as IDBCursorWithValue | null;
        if (!cursor) {
          db.close();
          resolve(index.size > 0 ? index : null);
          return;
        }

        const entry = cursor.value as { key?: string; token?: string; hashes?: string[] };
        if (entry.key !== "metadata" && entry.token && entry.hashes) {
          // Re-insert (delete + set) to move this token to the tail = most recently used
          if (index.has(entry.token)) {
            index.delete(entry.token);
          }
          index.set(entry.token, entry.hashes);
        }

        cursor.continue();
      };

      cursorReq.onerror = () => {
        db.close();
        reject(cursorReq.error);
      };
    });
  } catch (error) {
    logger.error("Failed to load search index from IndexedDB", {}, error instanceof Error ? error : undefined);
    return null;
  }
}

/**
 * Save index to IndexedDB. Clears any existing entries, then writes the
 * freshly built index with lifecycle policies applied (per-entry cap and
 * total-entry LRU eviction), then updates metadata.
 */
export async function saveIndexedDB(
  payments: PaymentRecord[],
  index: Map<string, string[]>
): Promise<void> {
  try {
    const db = await getDB();
    const tx = db.transaction([STORE_NAME], "readwrite");
    const store = tx.objectStore(STORE_NAME);

    // Clear existing index
    await new Promise<void>((resolve, reject) => {
      const clearReq = store.clear();
      clearReq.onsuccess = () => resolve();
      clearReq.onerror = () => reject(clearReq.error);
    });

    // Apply lifecycle policies before writing
    const bounded = evictOverflow(capHashesPerEntry(index));

    // Save index entries
    for (const [token, hashes] of bounded.entries()) {
      await new Promise<void>((resolve, reject) => {
        const putReq = store.put({ token, hashes }, token);
        putReq.onsuccess = () => resolve();
        putReq.onerror = () => reject(putReq.error);
      });
    }

    // Save metadata
    const metadata: TransactionIndexMetadata = {
      key: "metadata",
      lastIndexed: Date.now(),
      transactionCount: payments.length,
    };

    await new Promise<void>((resolve, reject) => {
      const putReq = store.put(metadata, "metadata");
      putReq.onsuccess = () => resolve();
      putReq.onerror = () => reject(putReq.error);
    });

    db.close();
  } catch (error) {
    logger.error("Failed to save search index to IndexedDB", {}, error instanceof Error ? error : undefined);
  }
}

/**
 * Remove hashes that reference deleted/replaced payments from the persisted
 * index. Entries that become empty are dropped entirely. Returns the number of
 * hash references removed.
 */
export async function invalidate(hashes: string[]): Promise<number> {
  try {
    if (hashes.length === 0) {
      return 0;
    }
    const db = await getDB();
    const tx = db.transaction([STORE_NAME], "readwrite");
    const store = tx.objectStore(STORE_NAME);

    const toRemove = new Set(hashes);
    let removedCount = 0;

    return new Promise((resolve, reject) => {
      const cursorReq = store.openCursor();

      cursorReq.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result as IDBCursorWithValue | null;
        if (!cursor) {
          db.close();
          resolve(removedCount);
          return;
        }

        const entry = cursor.value as { key?: string; token?: string; hashes?: string[] };
        if (entry.key !== "metadata" && entry.token && entry.hashes) {
          const before = entry.hashes.length;
          const remaining = entry.hashes.filter((h) => !toRemove.has(h));
          if (remaining.length !== before) {
            removedCount += before - remaining.length;
            if (remaining.length === 0) {
              cursor.delete();
            } else {
              cursor.update({ token: entry.token, hashes: remaining });
            }
          }
        }

        cursor.continue();
      };

      cursorReq.onerror = () => {
        db.close();
        reject(cursorReq.error);
      };
    });
  } catch (error) {
    logger.error("Failed to invalidate search index", {}, error instanceof Error ? error : undefined);
    return 0;
  }
}

/**
 * Clear IndexedDB
 */
export async function clearIndexedDB(): Promise<void> {
  try {
    const db = await getDB();
    const tx = db.transaction([STORE_NAME], "readwrite");
    const store = tx.objectStore(STORE_NAME);

    return new Promise((resolve, reject) => {
      const clearReq = store.clear();
      clearReq.onsuccess = () => {
        db.close();
        resolve();
      };
      clearReq.onerror = () => reject(clearReq.error);
    });
  } catch (error) {
    logger.error("Failed to clear search index", {}, error instanceof Error ? error : undefined);
  }
}

/**
 * Get metadata about the indexed transactions
 */
export async function getIndexMetadata(): Promise<TransactionIndexMetadata | null> {
  try {
    const db = await getDB();
    const tx = db.transaction([STORE_NAME], "readonly");
    const store = tx.objectStore(STORE_NAME);

    return new Promise((resolve, reject) => {
      const getReq = store.get("metadata");
      getReq.onsuccess = () => {
        db.close();
        resolve(getReq.result || null);
      };
      getReq.onerror = () => reject(getReq.error);
    });
  } catch (error) {
    logger.error("Failed to get index metadata", {}, error instanceof Error ? error : undefined);
    return null;
  }
}

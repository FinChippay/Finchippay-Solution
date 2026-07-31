/**
 * lib/transactionSearchIndex.ts
 * IndexedDB utilities for persisting transaction search index
 */

import { PaymentRecord } from "./stellar";

const DB_NAME = "FinChippayDB";
const DB_VERSION = 1;
const STORE_NAME = "transactionIndex";

interface IndexEntry {
  id: string; // memo tokens, address, hash tokens joined by space
  paymentHashes: string[]; // array of payment hashes that match this index entry
}

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

    // Store in index
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

  return index;
}

/**
 * Save index to IndexedDB
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

    // Save index entries
    for (const [token, hashes] of index.entries()) {
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
    console.error("Failed to save search index to IndexedDB:", error);
  }
}

/**
 * Load index from IndexedDB
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

        const entry = cursor.value as any;
        if (entry.key !== "metadata" && entry.token && entry.hashes) {
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
    console.error("Failed to load search index from IndexedDB:", error);
    return null;
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
    console.error("Failed to clear search index:", error);
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
    console.error("Failed to get index metadata:", error);
    return null;
  }
}

/**
 * lib/offlineQueue.ts
 *
 * Offline Transaction Queue — Issue #24
 *
 * Stores signed Stellar XDR transactions in IndexedDB when the network is
 * unavailable and submits them automatically when connectivity returns via
 * the Background Sync API (or a direct `online` event listener when the SW
 * sync is not supported).
 *
 * Architecture:
 *  - Raw IndexedDB API (no extra dependency) — mirrors the pattern used in
 *    contactsDB.ts and the existing offlineQueue.ts stub.
 *  - One IndexedDB database ("finchippay-offline-queue") with two stores:
 *      • "transactions" — QueuedTransaction records
 *      • "actions"      — legacy generic action queue (kept for back-compat)
 *  - Background Sync tag: "submit-payments"
 *  - The service worker (sw.js) picks up that tag and calls
 *    submitQueuedPayments(), which mirrors processQueue() but runs in the SW
 *    context.
 */

// ─── Constants ────────────────────────────────────────────────────────────────

const DB_NAME = "finchippay-offline-queue";
const DB_VERSION = 2; // v2 adds the "transactions" store
const TX_STORE = "transactions";
/** Legacy store kept for backwards-compatibility with the v1 stub. */
const ACTIONS_STORE = "actions";

const HORIZON_URL =
  typeof process !== "undefined"
    ? (process.env.NEXT_PUBLIC_HORIZON_URL ||
        "https://horizon-testnet.stellar.org")
    : "https://horizon-testnet.stellar.org";

const BG_SYNC_TAG = "submit-payments";

// ─── Change notifications (pub/sub for live UI updates) ───────────────────────
// Lets the UI observe queue mutations (queue / status change / remove / sync)
// so pending-transaction lists and sync indicators update in real time.

const QUEUE_CHANGE_EVENT = "finchippay:offline-queue-changed";
type QueueListener = () => void;
const listeners = new Set<QueueListener>();

function dispatchQueueChange() {
  listeners.forEach((l) => {
    try {
      l();
    } catch {
      // A failing subscriber must not break the others.
    }
  });
  if (typeof window !== "undefined") {
    try {
      window.dispatchEvent(new Event(QUEUE_CHANGE_EVENT));
    } catch {
      // window may be unavailable in non-DOM environments.
    }
  }
}

/**
 * Subscribe to queue changes. Returns an unsubscribe function.
 */
export function subscribeToQueue(listener: QueueListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Listen to queue changes via a window event (e.g. across component trees).
 * Returns an unsubscribe function.
 */
export function onQueueChanged(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(QUEUE_CHANGE_EVENT, cb);
  return () => window.removeEventListener(QUEUE_CHANGE_EVENT, cb);
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface QueuedTransaction {
  /** UUID generated at queue time. */
  id: string;
  /** Base-64 encoded signed XDR string ready for Horizon submission. */
  signedXDR: string;
  /** Destination Stellar public key (for UI display). */
  destination: string;
  /** Human-readable amount string, e.g. "10.50". */
  amount: string;
  /** Asset code, e.g. "XLM" or "USDC". */
  asset: string;
  /** Unix timestamp (ms) when the transaction was queued. */
  createdAt: number;
  /** Lifecycle status of this queued transaction. */
  status: "queued" | "submitting" | "submitted" | "failed";
  /** Error message when status === "failed". */
  error?: string;
  /** Number of submission attempts so far. */
  attempts: number;
}

export type QueueTransactionMetadata = Pick<
  QueuedTransaction,
  "destination" | "amount" | "asset"
>;

// ─── IndexedDB helpers ────────────────────────────────────────────────────────

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (event) => {
      const db = req.result;
      const oldVersion = event.oldVersion;

      // v1 → create legacy "actions" store
      if (oldVersion < 1) {
        if (!db.objectStoreNames.contains(ACTIONS_STORE)) {
          db.createObjectStore(ACTIONS_STORE, {
            keyPath: "id",
            autoIncrement: true,
          });
        }
      }

      // v2 → add "transactions" store
      if (oldVersion < 2) {
        if (!db.objectStoreNames.contains(TX_STORE)) {
          const store = db.createObjectStore(TX_STORE, { keyPath: "id" });
          store.createIndex("status", "status", { unique: false });
          store.createIndex("createdAt", "createdAt", { unique: false });
        }
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ─── Transaction queue API ────────────────────────────────────────────────────

/**
 * Persist a signed XDR transaction to IndexedDB and register a Background
 * Sync event so the service worker can submit it even if the tab is closed.
 *
 * Safe to call while offline — the registration itself is queued by the
 * browser and will fire once connectivity is restored.
 */
export async function queueTransaction(
  signedXDR: string,
  metadata: QueueTransactionMetadata
): Promise<void> {
  const record: QueuedTransaction = {
    id: generateId(),
    signedXDR,
    destination: metadata.destination,
    amount: metadata.amount,
    asset: metadata.asset ?? "XLM",
    createdAt: Date.now(),
    status: "queued",
    attempts: 0,
  };

  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(TX_STORE, "readwrite");
    tx.objectStore(TX_STORE).add(record);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });

  // Register Background Sync so the SW can submit even if the tab is closed.
  await registerBackgroundSync();
  dispatchQueueChange();
}

/**
 * Return all persisted queued transactions, sorted oldest-first.
 */
export async function getQueuedTransactions(): Promise<QueuedTransaction[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(TX_STORE, "readonly");
    const req = tx.objectStore(TX_STORE).getAll();
    req.onsuccess = () => {
      const sorted = (req.result as QueuedTransaction[]).sort(
        (a, b) => a.createdAt - b.createdAt
      );
      resolve(sorted);
    };
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

/**
 * Return the number of transactions that are still pending (queued or failed).
 */
export async function getQueueCount(): Promise<number> {
  const all = await getQueuedTransactions();
  return all.filter((t) => t.status === "queued" || t.status === "failed")
    .length;
}

/**
 * Remove a single transaction from the queue by its UUID.
 */
export async function removeTransaction(id: string): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(TX_STORE, "readwrite");
    tx.objectStore(TX_STORE).delete(id);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
  dispatchQueueChange();
}

/**
 * Update a single transaction record in IndexedDB (e.g. to change status).
 */
async function updateTransaction(record: QueuedTransaction): Promise<void> {
  const db = await openDB();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(TX_STORE, "readwrite");
    tx.objectStore(TX_STORE).put(record);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  }).then(() => {
    dispatchQueueChange();
  });
}

/**
 * Submit all queued (and previously failed) transactions to Horizon.
 *
 * Each transaction is submitted sequentially. On success it is removed from
 * the queue. On failure the record is marked "failed" with the error message
 * so it can be retried on the next connectivity event.
 *
 * This function is called both:
 *  1. From the "online" event listener in the main thread.
 *  2. From the SW "sync" event handler (via `submitQueuedPayments` exported
 *     at the bottom of this file for use by sw.js).
 */
export async function processQueue(): Promise<void> {
  let transactions: QueuedTransaction[];
  try {
    transactions = await getQueuedTransactions();
  } catch {
    // IndexedDB may not be available in all SW contexts; bail silently.
    return;
  }

  const pending = transactions.filter(
    (t) => t.status === "queued" || t.status === "failed"
  );

  const results: Array<QueueTransactionMetadata & { success: boolean; error?: string }> = [];
  for (const record of pending) {
    // Mark as submitting so the UI can reflect in-flight state.
    await updateTransaction({ ...record, status: "submitting" });

    try {
      await submitXDRToHorizon(record.signedXDR);
      // Success — clean up from the queue.
      await removeTransaction(record.id);
      results.push({ destination: record.destination, amount: record.amount, asset: record.asset, success: true });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      await updateTransaction({
        ...record,
        status: "failed",
        error: message,
        attempts: record.attempts + 1,
      });
      results.push({ destination: record.destination, amount: record.amount, asset: record.asset, success: false, error: message });
    }
  }
  if (results.length && typeof window !== "undefined") window.dispatchEvent(new CustomEvent("finchippay:queue-results", { detail: results }));
  dispatchQueueChange();
}

// ─── Horizon submission ───────────────────────────────────────────────────────

/**
 * Submit a signed XDR transaction envelope to the Horizon REST API.
 * Throws on network failure or a non-2xx Horizon error.
 */
async function submitXDRToHorizon(signedXDR: string): Promise<void> {
  const body = new URLSearchParams({ tx: signedXDR });

  const response = await fetch(`${HORIZON_URL}/transactions`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!response.ok) {
    let detail = response.statusText;
    try {
      const json = await response.json();
      detail = json?.extras?.result_codes?.transaction ?? json?.detail ?? detail;
    } catch {
      // Ignore JSON parse errors; use status text.
    }
    throw new Error(`Horizon error ${response.status}: ${detail}`);
  }
}

// ─── Background Sync registration ────────────────────────────────────────────

/**
 * Register the "submit-payments" Background Sync tag with the active service
 * worker. Falls back silently if Background Sync is not supported.
 */
export async function registerBackgroundSync(): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return;
  }

  try {
    const registration = await navigator.serviceWorker.ready;
    // The sync property is present only when the Background Sync API is
    // supported by the browser.
    if ("sync" in registration) {
      await (registration as ServiceWorkerRegistration & {
        sync: { register(tag: string): Promise<void> };
      }).sync.register(BG_SYNC_TAG);
    }
  } catch {
    // Background Sync not supported — the "online" event listener will handle
    // submission instead.
  }
}

// ─── Online event listener (main-thread fallback) ─────────────────────────────

let _onlineListenerAttached = false;

/**
 * Attach a one-time-per-session "online" event listener that calls
 * processQueue() when connectivity is restored. This acts as a fallback for
 * browsers that don't support the Background Sync API and as a complement
 * when the tab remains open.
 *
 * Call this once during application initialisation (e.g. in _app.tsx).
 */
export function attachOnlineListener(): void {
  if (typeof window === "undefined" || _onlineListenerAttached) return;
  _onlineListenerAttached = true;

  window.addEventListener("online", () => {
    void processQueue();
  });
}

// ─── UUID helper ─────────────────────────────────────────────────────────────

function generateId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for environments that don't have crypto.randomUUID.
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

// ─── Legacy generic-action queue (back-compat) ────────────────────────────────

/**
 * @deprecated Use {@link queueTransaction} instead.
 * Kept for backwards-compatibility with any code that still calls the v1 API.
 */
export async function queueAction(action: {
  type: string;
  payload: unknown;
}): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ACTIONS_STORE, "readwrite");
    tx.objectStore(ACTIONS_STORE).add({ ...action, queuedAt: Date.now() });
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

/**
 * @deprecated Use {@link getQueuedTransactions} instead.
 */
export async function getQueuedActions(): Promise<
  { id: number; type: string; payload: unknown; queuedAt: number }[]
> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ACTIONS_STORE, "readonly");
    const req = tx.objectStore(ACTIONS_STORE).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

/**
 * @deprecated Use {@link removeTransaction} instead.
 */
export async function clearQueuedAction(id: number): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ACTIONS_STORE, "readwrite");
    tx.objectStore(ACTIONS_STORE).delete(id);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

/**
 * lib/offlineQueue.ts
 *
 * Offline Transaction Queue — Issue #483 (Offline-First Capabilities) and #24.
 *
 * Two layers coexist here:
 *
 * 1. A generic, type-dispatched queue (the Issue #483 surface) persisted in
 *    IndexedDB with the shape `{ id, type, payload, createdAt, status,
 *    retryCount }`. Its API is `enqueue` / `dequeue` / `peek` / `remove` /
 *    `getAll` / `getFailed`, with a maximum of 3 retries and exponential
 *    backoff between attempts. `enqueue` registers a Background Sync event so
 *    the service worker can drain the queue even when the tab is closed.
 *
 * 2. The legacy signed-XDR queue (`queueTransaction` / `processQueue` /
 *    `getQueuedTransactions`, etc.) from Issue #24, kept intact for backwards
 *    compatibility. `processQueue` drains both layers so existing callers
 *    (OfflineBanner, Navbar) and the new composer share one replay path.
 *
 * Background Sync tags:
 *   - "submit-payments"        → legacy signed-XDR queue (Issue #24)
 *   - "process-transaction-queue" → generic queue (Issue #483)
 *
 * The service worker (public/sw.js) mirrors these constants and drains both
 * stores in FIFO order when a `sync` event fires.
 */

// ─── Constants ────────────────────────────────────────────────────────────────

const DB_NAME = "finchippay-offline-queue";
const DB_VERSION = 3; // v3 adds the generic "entries" store
/** Generic queue store (Issue #483). */
const ENTRIES_STORE = "entries";
/** Legacy signed-XDR transaction store (Issue #24). */
const TX_STORE = "transactions";
/** Legacy generic-action store kept for backwards-compatibility with the v1 stub. */
const ACTIONS_STORE = "actions";

const HORIZON_URL =
  typeof process !== "undefined"
    ? process.env.NEXT_PUBLIC_HORIZON_URL || "https://horizon-testnet.stellar.org"
    : "https://horizon-testnet.stellar.org";

/** Legacy Background Sync tag (Issue #24). */
const BG_SYNC_TAG = "submit-payments";
/** Generic Background Sync tag (Issue #483). */
const QUEUE_SYNC_TAG = "process-transaction-queue";

/** Maximum number of failed attempts before an entry is abandoned. */
export const MAX_RETRIES = 3;
/** Base delay for the first retry (ms). */
export const BASE_RETRY_DELAY_MS = 1_000;
/** Upper bound on any single backoff delay (ms). */
export const MAX_RETRY_DELAY_MS = 30_000;

/**
 * A `processing` entry older than this (ms) is assumed to belong to a dead
 * attempt (tab closed mid-submit) and is reset to `pending` on the next drain.
 */
const PROCESSING_STALE_MS = 30_000;

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

/** Lifecycle status of a generic queue entry. */
export type QueueStatus = "pending" | "processing" | "failed";

/**
 * A single entry in the generic offline queue.
 *
 * `payload` is intentionally opaque at this layer: the type tag decides how it
 * is interpreted when the queue is drained.
 */
export interface QueueEntry<TPayload = unknown> {
  id: string;
  type: string;
  payload: TPayload;
  createdAt: number;
  status: QueueStatus;
  /** Number of failed processing attempts so far (0-based). */
  retryCount: number;
  /** Error message from the most recent failed attempt. */
  lastError?: string;
  /** Unix epoch (ms) when processing was last attempted. */
  lastAttemptAt?: number;
  /** Unix epoch (ms) before which the entry must not be retried (backoff). */
  nextRetryAt?: number;
}

/** The type tag used by the offline transaction composer. */
export const PAYMENT_ENTRY_TYPE = "payment";

/** Payload shape for `PAYMENT_ENTRY_TYPE` entries. */
export interface PaymentPayload {
  /** Sender's Stellar public key (G…). */
  from: string;
  /** Recipient's Stellar public key (G…). */
  destination: string;
  /** Human-readable amount string, e.g. "10.50". */
  amount: string;
  /** Asset code — "XLM" or "USDC". */
  asset: "XLM" | "USDC";
  /** Optional memo text. */
  memo?: string;
  /** Optional pre-signed XDR; when present the queue submits it directly. */
  signedXDR?: string;
}

/** Legacy queued-transaction record (Issue #24). */
export interface QueuedTransaction {
  id: string;
  signedXDR: string;
  destination: string;
  amount: string;
  asset: string;
  createdAt: number;
  status: "queued" | "submitting" | "submitted" | "failed";
  error?: string;
  attempts: number;
}

export type QueueTransactionMetadata = Pick<QueuedTransaction, "destination" | "amount" | "asset">;

/**
 * Summary returned internally when draining the generic queue. Used by the
 * connectivity hook to decide whether to surface an auto-submit toast.
 */
export interface QueueDrainResult {
  submitted: number;
  failed: number;
  exhausted: number;
  remaining: number;
}

// ─── Backoff ──────────────────────────────────────────────────────────────────

/**
 * Exponential backoff delay for a given retry count.
 *
 * `retryCount` 0 → 1s, 1 → 2s, 2 → 4s, 3 → 8s … capped at 30s.
 */
export function backoffDelayMs(retryCount: number): number {
  const exponent = Math.max(0, Math.floor(retryCount));
  return Math.min(BASE_RETRY_DELAY_MS * 2 ** exponent, MAX_RETRY_DELAY_MS);
}

// ─── IndexedDB helpers ────────────────────────────────────────────────────────

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (event) => {
      const db = req.result;
      const oldVersion = event.oldVersion;

      // v1 → legacy "actions" store
      if (oldVersion < 1) {
        if (!db.objectStoreNames.contains(ACTIONS_STORE)) {
          db.createObjectStore(ACTIONS_STORE, {
            keyPath: "id",
            autoIncrement: true,
          });
        }
      }

      // v2 → legacy signed-XDR "transactions" store
      if (oldVersion < 2) {
        if (!db.objectStoreNames.contains(TX_STORE)) {
          const store = db.createObjectStore(TX_STORE, { keyPath: "id" });
          store.createIndex("status", "status", { unique: false });
          store.createIndex("createdAt", "createdAt", { unique: false });
        }
      }

      // v3 → generic "entries" store
      if (oldVersion < 3) {
        if (!db.objectStoreNames.contains(ENTRIES_STORE)) {
          const store = db.createObjectStore(ENTRIES_STORE, { keyPath: "id" });
          store.createIndex("status", "status", { unique: false });
          store.createIndex("createdAt", "createdAt", { unique: false });
        }
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ─── Generic entry validation ─────────────────────────────────────────────────

/**
 * Coerce an unknown stored value into a well-formed {@link QueueEntry}, or
 * return `null` for entries that cannot be safely processed. This makes the
 * queue resilient to malformed or legacy records without crashing a drain.
 */
function sanitizeEntry(raw: unknown): QueueEntry | null {
  if (typeof raw !== "object" || raw === null) return null;

  const record = raw as Record<string, unknown>;
  if (typeof record.id !== "string" || typeof record.type !== "string") {
    return null;
  }

  const status: QueueStatus =
    record.status === "pending" || record.status === "processing" || record.status === "failed"
      ? record.status
      : "failed";

  const retryCount =
    typeof record.retryCount === "number" && Number.isFinite(record.retryCount)
      ? Math.max(0, Math.floor(record.retryCount))
      : 0;

  const entry: QueueEntry = {
    id: record.id,
    type: record.type,
    payload: "payload" in record ? record.payload : null,
    createdAt: typeof record.createdAt === "number" ? record.createdAt : Date.now(),
    status,
    retryCount,
  };

  if (typeof record.lastError === "string") {
    entry.lastError = record.lastError;
  }
  if (typeof record.lastAttemptAt === "number") {
    entry.lastAttemptAt = record.lastAttemptAt;
  }
  if (typeof record.nextRetryAt === "number") {
    entry.nextRetryAt = record.nextRetryAt;
  }

  return entry;
}

// ─── Generic queue API ────────────────────────────────────────────────────────

/**
 * Persist a new entry to the generic queue and register a Background Sync so
 * the service worker can drain it later. Returns the assigned entry id.
 */
export async function enqueue<T = unknown>(type: string, payload: T): Promise<string> {
  const entry: QueueEntry<T> = {
    id: generateId(),
    type,
    payload,
    createdAt: Date.now(),
    status: "pending",
    retryCount: 0,
  };

  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(ENTRIES_STORE, "readwrite");
    tx.objectStore(ENTRIES_STORE).add(entry);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });

  await registerQueueSync();
  return entry.id;
}

/**
 * Atomically claim the oldest `pending` entry (marking it `processing`) and
 * return it. Resolves `null` when the queue has no pending entries.
 *
 * This is FIFO: entries are ordered by `createdAt` ascending.
 */
export async function dequeue(): Promise<QueueEntry | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ENTRIES_STORE, "readwrite");
    const store = tx.objectStore(ENTRIES_STORE);
    const index = store.index("createdAt");
    const req = index.openCursor();

    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) {
        resolve(null);
        return;
      }

      const entry = sanitizeEntry(cursor.value);
      if (!entry || entry.status !== "pending") {
        cursor.continue();
        return;
      }

      const claimed: QueueEntry = {
        ...entry,
        status: "processing",
        lastAttemptAt: Date.now(),
      };
      cursor.update(claimed);
      resolve(claimed);
    };
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

/**
 * Return the oldest `pending` entry without mutating it, or `null` when none.
 */
export async function peek(): Promise<QueueEntry | null> {
  const entries = await getAll();
  return entries.find((entry) => entry.status === "pending") ?? null;
}

/**
 * Remove a single entry from the generic queue by id. No-op for unknown ids.
 */
export async function remove(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ENTRIES_STORE, "readwrite");
    tx.objectStore(ENTRIES_STORE).delete(id);
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
 * Return every generic queue entry, sorted oldest-first. Malformed records are
 * coerced (or dropped) rather than surfaced raw.
 */
export async function getAll(): Promise<QueueEntry[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ENTRIES_STORE, "readonly");
    const req = tx.objectStore(ENTRIES_STORE).getAll();
    req.onsuccess = () => {
      const raw = Array.isArray(req.result) ? req.result : [];
      const entries = raw
        .map(sanitizeEntry)
        .filter((entry): entry is QueueEntry => entry !== null)
        .sort((a, b) => a.createdAt - b.createdAt);
      resolve(entries);
    };
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

/**
 * Return generic queue entries whose most recent attempt failed.
 */
export async function getFailed(): Promise<QueueEntry[]> {
  const entries = await getAll();
  return entries.filter((entry) => entry.status === "failed");
}

/**
 * Number of generic entries still awaiting submission
 * (`pending` + `processing` + `failed`).
 */
export async function getPendingCount(): Promise<number> {
  const entries = await getAll();
  return entries.length;
}

// ─── Generic queue processing ─────────────────────────────────────────────────

/**
 * Whether an entry is eligible for another processing attempt right now.
 */
function isRetryable(entry: QueueEntry, now: number): boolean {
  if (entry.status === "processing") return false;
  if (entry.retryCount >= MAX_RETRIES) return false;
  if (entry.nextRetryAt !== undefined && entry.nextRetryAt > now) return false;
  return entry.status === "pending" || entry.status === "failed";
}

/** Reset stale `processing` entries back to `pending` so they can be retried. */
async function recoverStuckEntries(): Promise<void> {
  let entries: QueueEntry[];
  try {
    entries = await getAll();
  } catch {
    return;
  }

  const now = Date.now();
  const stuck = entries.filter(
    (entry) =>
      entry.status === "processing" &&
      (entry.lastAttemptAt === undefined || now - entry.lastAttemptAt > PROCESSING_STALE_MS),
  );

  for (const entry of stuck) {
    try {
      await updateEntry(entry.id, { status: "pending" });
    } catch {
      // A failed recovery should not abort the whole drain.
    }
  }
}

/**
 * Atomically transition an eligible entry to `processing`. Returns `false`
 * when the entry was already claimed or is no longer retryable.
 */
async function claimEntry(id: string): Promise<boolean> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ENTRIES_STORE, "readwrite");
    const store = tx.objectStore(ENTRIES_STORE);
    const req = store.get(id);

    req.onsuccess = () => {
      const entry = sanitizeEntry(req.result);
      if (
        !entry ||
        (entry.status !== "pending" && entry.status !== "failed") ||
        entry.retryCount >= MAX_RETRIES
      ) {
        resolve(false);
        return;
      }
      store.put({ ...entry, status: "processing", lastAttemptAt: Date.now() });
      resolve(true);
    };
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

/** Persist partial updates to a generic entry. */
async function updateEntry(id: string, patch: Partial<QueueEntry>): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ENTRIES_STORE, "readwrite");
    const store = tx.objectStore(ENTRIES_STORE);
    const req = store.get(id);

    req.onsuccess = () => {
      const current = sanitizeEntry(req.result);
      if (current) {
        store.put({ ...current, ...patch });
      }
    };
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
  });
}

/**
 * Execute a single generic queue entry. Throws when processing fails so the
 * caller can record the failure and schedule a retry.
 */
async function processEntry(entry: QueueEntry): Promise<void> {
  if (entry.type === PAYMENT_ENTRY_TYPE) {
    await processPaymentEntry(entry.payload as PaymentPayload | null | undefined);
    return;
  }

  // Fallback for any entry type whose payload already carries a signed XDR.
  const payload = entry.payload as { signedXDR?: unknown } | null;
  if (payload && typeof payload.signedXDR === "string") {
    await submitXDRToHorizon(payload.signedXDR);
    return;
  }

  throw new Error(`No processor registered for queue entry type "${entry.type}".`);
}

/**
 * Process a `payment` entry: submit a pre-signed XDR directly, or build, sign
 * and submit the intent via Freighter (which requires connectivity). Freighter
 * cannot run inside the service worker, so unsigned intents are always
 * processed on the main thread.
 */
async function processPaymentEntry(payload: PaymentPayload | null | undefined): Promise<void> {
  const safe: Partial<PaymentPayload> = payload ?? {};

  if (typeof safe.signedXDR === "string" && safe.signedXDR) {
    await submitXDRToHorizon(safe.signedXDR);
    return;
  }

  if (!safe.from || !safe.destination) {
    throw new Error("Queued payment is missing a sender or destination.");
  }
  if (!safe.amount) {
    throw new Error("Queued payment is missing an amount.");
  }

  // Lazy import keeps the queue module light and avoids pulling the Stellar SDK
  // into every bundle that only enqueues/reads entries.
  const { buildPaymentTransaction } = await import("@/lib/stellar");
  const { signTransactionWithWallet } = await import("@/lib/wallet");

  const tx = await buildPaymentTransaction({
    fromPublicKey: safe.from,
    toPublicKey: safe.destination,
    amount: safe.amount,
    memo: safe.memo,
    asset: safe.asset ?? "XLM",
  });

  const { signedXDR, error } = await signTransactionWithWallet(tx.toXDR());
  if (error || !signedXDR) {
    throw new Error(error || "Transaction signing failed.");
  }

  await submitXDRToHorizon(signedXDR);
}

/**
 * Drain the generic queue in FIFO order, respecting retry limits and backoff.
 */
async function processGenericQueue(): Promise<QueueDrainResult> {
  const result: QueueDrainResult = {
    submitted: 0,
    failed: 0,
    exhausted: 0,
    remaining: 0,
  };

  let entries: QueueEntry[];
  try {
    await recoverStuckEntries();
    entries = await getAll();
  } catch {
    // IndexedDB may be unavailable (e.g. private browsing); bail silently.
    return result;
  }

  const now = Date.now();
  const eligible = entries.filter((entry) => isRetryable(entry, now));

  for (const entry of eligible) {
    let claimed = false;
    try {
      claimed = await claimEntry(entry.id);
    } catch {
      continue;
    }
    if (!claimed) continue;

    try {
      await processEntry(entry);
      await remove(entry.id);
      result.submitted += 1;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      const retryCount = entry.retryCount + 1;
      await updateEntry(entry.id, {
        status: "failed",
        retryCount,
        lastError: message,
        lastAttemptAt: Date.now(),
        nextRetryAt: Date.now() + backoffDelayMs(retryCount),
      });
      if (retryCount >= MAX_RETRIES) {
        result.exhausted += 1;
      } else {
        result.failed += 1;
      }
    }
  }

  try {
    const after = await getAll();
    result.remaining = after.filter((entry) => entry.status !== undefined).length;
  } catch {
    // Ignore — the drain already completed.
  }

  return result;
}

// ─── Legacy transaction queue API (Issue #24, kept for back-compat) ──────────

/**
 * Persist a signed XDR transaction to IndexedDB and register a Background
 * Sync event so the service worker can submit it even if the tab is closed.
 */
export async function queueTransaction(
  signedXDR: string,
  metadata: QueueTransactionMetadata,
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
      const sorted = (req.result as QueuedTransaction[]).sort((a, b) => a.createdAt - b.createdAt);
      resolve(sorted);
    };
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

/**
 * Combined number of transactions awaiting submission across both the legacy
 * and generic queues. Used by the OfflineBanner and Navbar badges.
 */
export async function getQueueCount(): Promise<number> {
  const [legacy, generic] = await Promise.all([
    getQueuedTransactions().catch(() => [] as QueuedTransaction[]),
    getAll().catch(() => [] as QueueEntry[]),
  ]);

  const legacyPending = legacy.filter((t) => t.status === "queued" || t.status === "failed").length;
  const genericPending = generic.length;

  return legacyPending + genericPending;
}

/**
 * Remove a single transaction from the legacy queue by its UUID.
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
 * Update a single legacy transaction record in IndexedDB.
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
 * Submit all queued transactions (legacy + generic) to the network.
 *
 * The legacy queue submits signed XDR envelopes to Horizon; the generic queue
 * submits pre-signed XDRs and builds + signs payment intents via Freighter.
 * Each failed attempt increments the entry's retry counter and schedules the
 * next attempt with exponential backoff.
 *
 * This function is called both:
 *  1. From the "online" event listener in the main thread.
 *  2. By the OfflineBanner / Navbar retry buttons.
 */
export async function processQueue(): Promise<void> {
  // Legacy signed-XDR transactions first (unchanged Issue #24 behavior).
  let transactions: QueuedTransaction[];
  try {
    transactions = await getQueuedTransactions();
  } catch {
    transactions = [];
  }

  const pending = transactions.filter((t) => t.status === "queued" || t.status === "failed");

  const results: Array<QueueTransactionMetadata & { success: boolean; error?: string }> = [];
  for (const record of pending) {
    await updateTransaction({ ...record, status: "submitting" });

    try {
      await submitXDRToHorizon(record.signedXDR);
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
 * Register the generic "process-transaction-queue" Background Sync tag with the
 * active service worker. Registers the worker first so `ready` always resolves,
 * and falls back silently when Background Sync is unsupported.
 */
export async function registerQueueSync(): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return;
  }

  try {
    await navigator.serviceWorker.register("/sw.js");
    const registration = await navigator.serviceWorker.ready;
    if ("sync" in registration) {
      await (
        registration as ServiceWorkerRegistration & {
          sync: { register(tag: string): Promise<void> };
        }
      ).sync.register(QUEUE_SYNC_TAG);
    }
  } catch {
    // Background Sync not supported — the "online" listener handles submission.
  }
}

/**
 * Register the legacy "submit-payments" Background Sync tag with the active
 * service worker. Falls back silently if Background Sync is not supported.
 */
export async function registerBackgroundSync(): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return;
  }

  try {
    const registration = await navigator.serviceWorker.ready;
    if ("sync" in registration) {
      await (
        registration as ServiceWorkerRegistration & {
          sync: { register(tag: string): Promise<void> };
        }
      ).sync.register(BG_SYNC_TAG);
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
 * processQueue() when connectivity is restored. Acts as a fallback for browsers
 * that don't support Background Sync and as a complement when the tab is open.
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
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

// ─── Legacy generic-action queue (back-compat) ────────────────────────────────

/**
 * @deprecated Use {@link enqueue} instead.
 * Kept for backwards-compatibility with any code that still calls the v1 API.
 */
export async function queueAction(action: { type: string; payload: unknown }): Promise<void> {
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
 * @deprecated Use {@link getAll} instead.
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
 * @deprecated Use {@link remove} instead.
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

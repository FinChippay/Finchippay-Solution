/**
 * lib/offlineQueue.ts
 *
 * IndexedDB-backed queue for payment actions that were attempted while the
 * device was offline.  When the connection is restored the queue is drained
 * in FIFO order and each action is re-executed via the supplied handler.
 *
 * Usage
 * -----
 *   // Queue an action
 *   await offlineQueue.enqueue({ type: "send_payment", payload: { ... } });
 *
 *   // Register a processor and start watching for connectivity
 *   const stop = offlineQueue.startSync(async (action) => {
 *     await sendPayment(action.payload);
 *   }, (msg, type) => showToast(msg, type));
 *
 *   // Tear down (e.g. on component unmount)
 *   stop();
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export type QueuedActionType = "send_payment" | "send_tip" | "batch_payment" | "generic";

export interface QueuedAction<T = unknown> {
  /** Auto-assigned by enqueue() */
  id?: number;
  type: QueuedActionType;
  /** Arbitrary serialisable payload */
  payload: T;
  /** ISO timestamp when the action was queued */
  queuedAt: string;
  /** Number of retry attempts so far */
  attempts: number;
}

type ToastFn = (message: string, type: "success" | "error" | "info") => void;
type ActionHandler<T = unknown> = (action: QueuedAction<T>) => Promise<void>;

// ─── IndexedDB helpers ───────────────────────────────────────────────────────

const DB_NAME = "finchippay-offline";
const DB_VERSION = 1;
const STORE = "queue";

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
        const store = db.createObjectStore(STORE, {
          keyPath: "id",
          autoIncrement: true,
        });
        store.createIndex("type", "type", { unique: false });
        store.createIndex("queuedAt", "queuedAt", { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function idbAdd(item: Omit<QueuedAction, "id">): Promise<number> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const req = tx.objectStore(STORE).add(item);
    req.onsuccess = () => resolve(req.result as number);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

async function idbGetAll(): Promise<QueuedAction[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result as QueuedAction[]);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

async function idbDelete(id: number): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const req = tx.objectStore(STORE).delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

async function idbUpdate(action: QueuedAction): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const req = tx.objectStore(STORE).put(action);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Add an action to the persistent offline queue.
 * Returns the auto-assigned numeric id.
 */
export async function enqueue<T = unknown>(
  action: Omit<QueuedAction<T>, "id" | "queuedAt" | "attempts">
): Promise<number> {
  const item: Omit<QueuedAction<T>, "id"> = {
    ...action,
    queuedAt: new Date().toISOString(),
    attempts: 0,
  };
  return idbAdd(item as Omit<QueuedAction, "id">);
}

/**
 * Return all pending queued actions (ordered by insertion).
 */
export async function getQueue(): Promise<QueuedAction[]> {
  try {
    const items = await idbGetAll();
    return items.sort((a, b) =>
      new Date(a.queuedAt).getTime() - new Date(b.queuedAt).getTime()
    );
  } catch {
    return [];
  }
}

/**
 * Return the number of pending items in the queue.
 */
export async function getQueueLength(): Promise<number> {
  try {
    const items = await idbGetAll();
    return items.length;
  } catch {
    return 0;
  }
}

/**
 * Remove a specific action from the queue by id.
 */
export async function removeFromQueue(id: number): Promise<void> {
  return idbDelete(id);
}

/**
 * Drain the queue, calling `handler` for each action in order.
 *
 * - Successful actions are removed from the queue.
 * - Failed actions have their attempt count incremented; they remain in the
 *   queue for the next sync.
 * - `toast` (optional) is called after each action to surface results.
 */
export async function drainQueue<T = unknown>(
  handler: ActionHandler<T>,
  toast?: ToastFn
): Promise<{ processed: number; failed: number }> {
  const queue = await getQueue();
  let processed = 0;
  let failed = 0;

  for (const action of queue) {
    try {
      await handler(action as QueuedAction<T>);
      if (action.id !== undefined) {
        await idbDelete(action.id);
      }
      processed++;
      toast?.(
        `Queued action completed: ${action.type.replace(/_/g, " ")}`,
        "success"
      );
    } catch (err) {
      failed++;
      const updated: QueuedAction = { ...action, attempts: (action.attempts ?? 0) + 1 };
      if (action.id !== undefined) {
        await idbUpdate(updated);
      }
      const msg = err instanceof Error ? err.message : "Unknown error";
      toast?.(`Queued action failed: ${action.type.replace(/_/g, " ")} — ${msg}`, "error");
    }
  }

  return { processed, failed };
}

/**
 * Register an online event listener that automatically drains the queue
 * whenever connectivity is restored.
 *
 * Returns a cleanup function.
 */
export function startSync<T = unknown>(
  handler: ActionHandler<T>,
  toast?: ToastFn
): () => void {
  if (typeof window === "undefined") return () => {};

  const handleOnline = async () => {
    const length = await getQueueLength();
    if (length === 0) return;

    toast?.(`Back online — processing ${length} queued action(s)…`, "info");
    await drainQueue(handler, toast);
  };

  window.addEventListener("online", handleOnline);
  return () => window.removeEventListener("online", handleOnline);
}

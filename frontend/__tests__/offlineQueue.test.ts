/**
 * __tests__/offlineQueue.test.ts
 *
 * Tests for lib/offlineQueue.ts
 *
 * Strategy:
 *  - fake-indexeddb provides a real in-memory IDB implementation so we test
 *    actual IndexedDB interactions without mocking every call.
 *  - The Background Sync API and fetch are mocked at the module level.
 *  - processQueue() is exercised against a stubbed fetch.
 */

// ── IndexedDB polyfill ─────────────────────────────────────────────────────
// fake-indexeddb is already in devDependencies (used by contactsDB tests).
import "fake-indexeddb/auto";

// ── Mocks ─────────────────────────────────────────────────────────────────

// navigator.serviceWorker — provide a minimal mock.
const mockSyncRegister = jest.fn().mockResolvedValue(undefined);
const mockSwReady = Promise.resolve({
  sync: { register: mockSyncRegister },
  active: {
    postMessage: jest.fn(),
  },
});

Object.defineProperty(global, "navigator", {
  value: {
    onLine: true,
    serviceWorker: {
      ready: mockSwReady,
      register: jest.fn().mockResolvedValue(undefined),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    },
  },
  writable: true,
  configurable: true,
});

// fetch — controlled per test.
global.fetch = jest.fn();

// ── Imports (after mocks) ──────────────────────────────────────────────────

import {
  queueTransaction,
  getQueuedTransactions,
  getQueueCount,
  removeTransaction,
  processQueue,
  registerBackgroundSync,
  attachOnlineListener,
  // Legacy back-compat API
  queueAction,
  getQueuedActions,
  clearQueuedAction,
  // Issue #483 — generic queue API
  enqueue,
  dequeue,
  peek,
  remove,
  getAll,
  getFailed,
  getPendingCount,
  backoffDelayMs,
  MAX_RETRIES,
  PAYMENT_ENTRY_TYPE,
} from "@/lib/offlineQueue";

// ── Helpers ───────────────────────────────────────────────────────────────

const TEST_XDR = "AAAAAQAAAA...signedXDR==";
const TEST_META = { destination: "GDEST...ABC", amount: "10.00", asset: "XLM" };

function mockFetchOk() {
  (global.fetch as jest.Mock).mockResolvedValue({ ok: true } as Response);
}

function mockFetchFail(status = 500, statusText = "Internal Server Error") {
  (global.fetch as jest.Mock).mockResolvedValue({
    ok: false,
    status,
    statusText,
    json: async () => ({}),
  } as unknown as Response);
}

/** Poll until a mock has been called (for fire-and-forget async work). */
async function waitForCall(mock: jest.Mock, timeoutMs = 2000): Promise<void> {
  const startedAt = Date.now();
  while (mock.mock.calls.length === 0 && Date.now() - startedAt < timeoutMs) {
    await new Promise((r) => setTimeout(r, 10));
  }
}

const TEST_DB_NAME = "finchippay-offline-queue";
const TEST_DB_VERSION = 3;

function openTestDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(TEST_DB_NAME, TEST_DB_VERSION);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Move every entry's `nextRetryAt` into the past so backoff does not gate retries. */
async function clearBackoff() {
  const db = await openTestDb();
  await new Promise<void>((resolve) => {
    const tx = db.transaction("entries", "readwrite");
    const store = tx.objectStore("entries");
    const req = store.getAll();
    req.onsuccess = () => {
      for (const entry of req.result) {
        store.put({ ...entry, nextRetryAt: 0 });
      }
    };
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
  });
}

// ── Suite ─────────────────────────────────────────────────────────────────

/** Remove all transactions from IndexedDB to isolate each test. */
async function clearAll() {
  const items = await getQueuedTransactions();
  for (const t of items) await removeTransaction(t.id);

  const entries = await getAll();
  for (const entry of entries) await remove(entry.id);
}

describe("offlineQueue", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await clearAll();
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe("queueTransaction", () => {
    it("persists a transaction with status='queued'", async () => {
      await queueTransaction(TEST_XDR, TEST_META);

      const items = await getQueuedTransactions();
      expect(items).toHaveLength(1);

      const tx = items[0];
      expect(tx.signedXDR).toBe(TEST_XDR);
      expect(tx.destination).toBe(TEST_META.destination);
      expect(tx.amount).toBe(TEST_META.amount);
      expect(tx.asset).toBe(TEST_META.asset);
      expect(tx.status).toBe("queued");
      expect(tx.attempts).toBe(0);
      expect(typeof tx.id).toBe("string");
      expect(tx.createdAt).toBeLessThanOrEqual(Date.now());
    });

    it("assigns unique IDs to multiple transactions", async () => {
      await queueTransaction(TEST_XDR, TEST_META);
      await queueTransaction(TEST_XDR, { ...TEST_META, amount: "20.00" });

      const items = await getQueuedTransactions();
      expect(items).toHaveLength(2);
      const ids = items.map((t) => t.id);
      const unique = new Set(ids);
      expect(unique.size).toBe(2);
    });

    it("registers a Background Sync tag", async () => {
      await queueTransaction(TEST_XDR, TEST_META);
      expect(mockSyncRegister).toHaveBeenCalledWith("submit-payments");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe("getQueueCount", () => {
    it("counts only queued and failed transactions (not submitted)", async () => {
      const items = await getQueuedTransactions();
      const count = await getQueueCount();
      const pendingInDb = items.filter(
        (t) => t.status === "queued" || t.status === "failed",
      ).length;
      expect(count).toBe(pendingInDb);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe("removeTransaction", () => {
    it("removes a transaction by id", async () => {
      await queueTransaction(TEST_XDR, { ...TEST_META, amount: "99.00" });
      const before = await getQueuedTransactions();
      const last = before[before.length - 1];

      await removeTransaction(last.id);

      const after = await getQueuedTransactions();
      expect(after.find((t) => t.id === last.id)).toBeUndefined();
    });

    it("is a no-op for a non-existent id", async () => {
      const before = await getQueuedTransactions();
      await expect(removeTransaction("non-existent-id")).resolves.toBeUndefined();
      const after = await getQueuedTransactions();
      expect(after.length).toBe(before.length);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe("processQueue", () => {
    it("submits queued transactions to Horizon and removes them on success", async () => {
      mockFetchOk();

      await queueTransaction(TEST_XDR, TEST_META);
      expect(await getQueueCount()).toBe(1);

      await processQueue();

      expect(await getQueueCount()).toBe(0);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/transactions"),
        expect.objectContaining({ method: "POST" }),
      );
    });

    it("marks transactions as 'failed' when Horizon returns an error", async () => {
      mockFetchFail(400, "Bad Request");

      await queueTransaction(TEST_XDR, TEST_META);
      await processQueue();

      const items = await getQueuedTransactions();
      const failed = items.filter((t) => t.status === "failed");
      expect(failed.length).toBe(1);
      expect(failed[0].error).toMatch(/Horizon/);
      expect(failed[0].attempts).toBe(1);
    });

    it("retries previously failed transactions on the next processQueue call", async () => {
      mockFetchFail();

      await queueTransaction(TEST_XDR, TEST_META);
      await processQueue(); // First attempt → fails

      const afterFirst = await getQueuedTransactions();
      const failedTx = afterFirst.find((t) => t.status === "failed");
      expect(failedTx).toBeDefined();
      if (!failedTx) throw new Error("Expected a failed transaction");
      expect(failedTx.attempts).toBe(1);

      // Second attempt — now succeeds.
      mockFetchOk();
      await processQueue();

      const afterSecond = await getQueuedTransactions();
      expect(afterSecond.find((t) => t.id === failedTx.id)).toBeUndefined();
    });

    it("handles an empty queue gracefully", async () => {
      await expect(processQueue()).resolves.toBeUndefined();
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe("registerBackgroundSync", () => {
    it("calls sync.register with the correct tag", async () => {
      await registerBackgroundSync();
      expect(mockSyncRegister).toHaveBeenCalledWith("submit-payments");
    });

    it("does nothing when serviceWorker is absent", async () => {
      const original = (global.navigator as any).serviceWorker;
      delete (global.navigator as any).serviceWorker;

      await expect(registerBackgroundSync()).resolves.toBeUndefined();

      (global.navigator as any).serviceWorker = original;
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe("attachOnlineListener", () => {
    it("attaches an online event listener that calls processQueue", async () => {
      mockFetchOk();

      const prev = await getQueuedTransactions();
      for (const t of prev) await removeTransaction(t.id);
      await queueTransaction(TEST_XDR, TEST_META);

      attachOnlineListener();
      window.dispatchEvent(new Event("online"));

      // processQueue runs fire-and-forget on the "online" event; poll until
      // the submission reaches Horizon instead of assuming a single tick.
      await waitForCall(global.fetch as jest.Mock);

      expect(global.fetch).toHaveBeenCalled();
    });

    it("is idempotent — attaches at most one listener regardless of call count", () => {
      const addSpy = jest.spyOn(window, "addEventListener");
      attachOnlineListener();
      attachOnlineListener();
      attachOnlineListener();
      // The second and third calls are no-ops.
      const onlineCalls = addSpy.mock.calls.filter(([event]) => event === "online");
      expect(onlineCalls.length).toBeLessThanOrEqual(1);
      addSpy.mockRestore();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe("legacy back-compat API", () => {
    it("queueAction / getQueuedActions / clearQueuedAction round-trip", async () => {
      await queueAction({ type: "TEST_ACTION", payload: { foo: "bar" } });

      const actions = await getQueuedActions();
      expect(actions.length).toBeGreaterThanOrEqual(1);

      const last = actions[actions.length - 1];
      expect(last.type).toBe("TEST_ACTION");
      expect((last.payload as any).foo).toBe("bar");

      await clearQueuedAction(last.id as number);

      const after = await getQueuedActions();
      expect(after.find((a) => a.id === last.id)).toBeUndefined();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe("persistence across multiple calls", () => {
    it("returns transactions sorted oldest-first", async () => {
      const prev = await getQueuedTransactions();
      for (const t of prev) await removeTransaction(t.id);

      // Add two transactions with deterministic ordering.
      await queueTransaction(TEST_XDR, { ...TEST_META, amount: "1.00" });
      // Small artificial delay to ensure different createdAt values.
      await new Promise((r) => setTimeout(r, 5));
      await queueTransaction(TEST_XDR, { ...TEST_META, amount: "2.00" });

      const items = await getQueuedTransactions();
      expect(items[0].createdAt).toBeLessThanOrEqual(items[1].createdAt);
      expect(items[0].amount).toBe("1.00");
      expect(items[1].amount).toBe("2.00");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Issue #483 — generic queue API
  // ─────────────────────────────────────────────────────────────────────────

  describe("enqueue (generic queue)", () => {
    it("persists a pending entry with retryCount 0 and returns its id", async () => {
      const id = await enqueue(PAYMENT_ENTRY_TYPE, {
        destination: "GDEST...ABC",
        amount: "10.00",
      });

      expect(typeof id).toBe("string");

      const entries = await getAll();
      expect(entries).toHaveLength(1);

      const entry = entries[0];
      expect(entry.id).toBe(id);
      expect(entry.type).toBe(PAYMENT_ENTRY_TYPE);
      expect(entry.status).toBe("pending");
      expect(entry.retryCount).toBe(0);
      expect(entry.createdAt).toBeLessThanOrEqual(Date.now());
    });

    it("registers the process-transaction-queue Background Sync tag", async () => {
      await enqueue(PAYMENT_ENTRY_TYPE, {});
      expect(mockSyncRegister).toHaveBeenCalledWith("process-transaction-queue");
    });
  });

  describe("dequeue / peek", () => {
    it("dequeues entries in FIFO order and marks them processing", async () => {
      await enqueue("payment", { order: 1 });
      await new Promise((r) => setTimeout(r, 5));
      await enqueue("payment", { order: 2 });

      const first = await dequeue();
      const second = await dequeue();

      expect(first?.status).toBe("processing");
      expect((first?.payload as { order: number }).order).toBe(1);
      expect((second?.payload as { order: number }).order).toBe(2);
      expect(await dequeue()).toBeNull();
    });

    it("peek returns the oldest pending entry without mutating it", async () => {
      await enqueue("payment", { order: 1 });

      const peeked = await peek();
      expect(peeked?.status).toBe("pending");
      expect((peeked?.payload as { order: number }).order).toBe(1);

      const entries = await getAll();
      expect(entries[0].status).toBe("pending");
    });

    it("returns null when the queue is empty", async () => {
      expect(await dequeue()).toBeNull();
      expect(await peek()).toBeNull();
    });
  });

  describe("remove / getAll / getFailed / getPendingCount", () => {
    it("remove deletes an entry by id and is a no-op for unknown ids", async () => {
      const id = await enqueue("payment", {});
      await remove(id);
      expect(await getAll()).toHaveLength(0);

      await expect(remove("non-existent")).resolves.toBeUndefined();
    });

    it("getAll returns entries oldest-first", async () => {
      await enqueue("payment", { order: 1 });
      await new Promise((r) => setTimeout(r, 5));
      await enqueue("payment", { order: 2 });

      const entries = await getAll();
      expect(entries.map((e) => (e.payload as { order: number }).order)).toEqual([1, 2]);
    });

    it("getFailed returns only failed entries", async () => {
      await enqueue("payment", { signedXDR: "AAAA" });
      mockFetchFail(400, "Bad Request");
      await processQueue();

      expect(await getFailed()).toHaveLength(1);
    });

    it("getPendingCount reflects the number of entries awaiting submission", async () => {
      expect(await getPendingCount()).toBe(0);
      await enqueue("payment", {});
      expect(await getPendingCount()).toBe(1);
    });
  });

  describe("retry / backoff", () => {
    it("applies exponential backoff between retries", () => {
      expect(backoffDelayMs(0)).toBe(1000);
      expect(backoffDelayMs(1)).toBe(2000);
      expect(backoffDelayMs(2)).toBe(4000);
    });

    it("marks a failed entry with retryCount and a future nextRetryAt", async () => {
      mockFetchFail(500, "Server Error");
      await enqueue("payment", { signedXDR: "AAAA" });
      await processQueue();

      const [entry] = await getAll();
      expect(entry.status).toBe("failed");
      expect(entry.retryCount).toBe(1);
      expect(entry.lastError).toMatch(/Horizon/);
      expect(entry.nextRetryAt).toBeGreaterThan(Date.now());
    });

    it("skips a retry until nextRetryAt has passed (backoff)", async () => {
      mockFetchFail();
      await enqueue("payment", { signedXDR: "AAAA" });
      await processQueue(); // attempt 1 → failed, retryCount 1

      await processQueue(); // immediately → skipped due to backoff
      const [entry] = await getAll();
      expect(entry.retryCount).toBe(1);
    });

    it("stops retrying after MAX_RETRIES and leaves the entry failed", async () => {
      mockFetchFail();
      await enqueue("payment", { signedXDR: "AAAA" });

      for (let i = 0; i <= MAX_RETRIES; i += 1) {
        await processQueue();
        await clearBackoff();
      }

      const [entry] = await getAll();
      expect(entry.status).toBe("failed");
      expect(entry.retryCount).toBe(MAX_RETRIES);

      await processQueue(); // another drain should not increment further
      const [after] = await getAll();
      expect(after.retryCount).toBe(MAX_RETRIES);
    });
  });

  describe("malformed entries", () => {
    it("coerces malformed records without throwing and drains safely", async () => {
      const db = await openTestDb();
      await new Promise<void>((resolve) => {
        const tx = db.transaction("entries", "readwrite");
        const store = tx.objectStore("entries");
        store.add({ id: "bad-1", type: "payment" }); // missing status/createdAt
        store.add({ id: "bad-2", type: 123 }); // invalid type → dropped
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
      });

      const entries = await getAll();
      expect(entries.some((e) => e.id === "bad-1")).toBe(true);
      expect(entries.some((e) => e.id === "bad-2")).toBe(false);

      const bad = entries.find((e) => e.id === "bad-1");
      expect(bad?.status).toBe("failed");
      expect(bad?.retryCount).toBe(0);

      mockFetchOk();
      await expect(processQueue()).resolves.toBeUndefined();
    });
  });

  describe("persistence across reloads", () => {
    it("entries survive a simulated page reload (module re-import)", async () => {
      await enqueue("payment", { destination: "GDEST...ABC", amount: "5.00" });

      jest.resetModules();
      const fresh = await import("@/lib/offlineQueue");

      const entries = await fresh.getAll();
      expect(entries).toHaveLength(1);
      expect((entries[0].payload as { destination: string }).destination).toBe("GDEST...ABC");
    });
  });
});

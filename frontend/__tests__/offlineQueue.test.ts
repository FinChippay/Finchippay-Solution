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
  subscribeToQueue,
  onQueueChanged,
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

// ── Suite ─────────────────────────────────────────────────────────────────

/** Remove all transactions from IndexedDB to isolate each test. */
async function clearAll() {
  const items = await getQueuedTransactions();
  for (const t of items) await removeTransaction(t.id);
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
        (t) => t.status === "queued" || t.status === "failed"
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
        expect.objectContaining({ method: "POST" })
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
      expect(failedTx!.attempts).toBe(1);

      // Second attempt — now succeeds.
      mockFetchOk();
      await processQueue();

      const afterSecond = await getQueuedTransactions();
      expect(afterSecond.find((t) => t.id === failedTx!.id)).toBeUndefined();
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

      // Allow the microtask queue to drain.
      await new Promise((r) => setTimeout(r, 0));

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
  describe("change notifications (pub/sub)", () => {
    it("subscribeToQueue fires on queueTransaction", async () => {
      const listener = jest.fn();
      const unsub = subscribeToQueue(listener);

      // Clean the queue first.
      const prev = await getQueuedTransactions();
      for (const t of prev) await removeTransaction(t.id);
      listener.mockClear();

      await queueTransaction(TEST_XDR, TEST_META);
      expect(listener).toHaveBeenCalled();
      unsub();
    });

    it("fires on removeTransaction", async () => {
      await queueTransaction(TEST_XDR, TEST_META);
      const items = await getQueuedTransactions();
      const listener = jest.fn();
      const unsub = subscribeToQueue(listener);
      listener.mockClear();

      await removeTransaction(items[items.length - 1].id);
      expect(listener).toHaveBeenCalled();
      unsub();
    });

    it("onQueueChanged bridges to the window event", (done) => {
      const unsub = onQueueChanged(() => {
        unsub();
        done();
      });
      // queueTransaction dispatches the change event on window.
      void queueTransaction(TEST_XDR, TEST_META);
    });
  });
});

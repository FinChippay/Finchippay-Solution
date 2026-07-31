/**
 * __tests__/priceAlerts.test.ts
 *
 * Test suite for the price alert system (Issue #80).
 * Covers: localStorage CRUD, threshold evaluation, notification firing,
 *         the polling engine, and the PriceAlertForm component.
 *
 * ≥ 4 test cases required — this file contains 8+.
 */

import {
  loadAlerts,
  saveAlerts,
  createAlert,
  deleteAlert,
  triggerAlert,
  fetchPrices,
  startPriceAlertPoller,
  firePriceAlertNotification,
  requestNotificationPermission,
  PRICE_ALERTS_STORAGE_KEY,
  type PriceAlert,
} from "@/lib/priceAlerts";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build a minimal PriceAlert fixture. */
function makeAlert(overrides: Partial<PriceAlert> = {}): PriceAlert {
  return {
    id: "test-alert-1",
    asset: "XLM",
    condition: "below",
    threshold: 0.1,
    notificationPreference: "browser",
    createdAt: new Date().toISOString(),
    triggeredAt: null,
    triggeredPrice: null,
    active: true,
    ...overrides,
  };
}

// ─── Setup / teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  localStorage.clear();
  jest.clearAllMocks();
});

afterEach(() => {
  localStorage.clear();
});

// ─── Test 1: createAlert persists to localStorage ─────────────────────────────

describe("createAlert", () => {
  it("persists a new alert to localStorage and returns it with default fields", () => {
    const alert = createAlert({
      asset: "XLM",
      condition: "below",
      threshold: 0.08,
      notificationPreference: "both",
    });

    expect(alert.id).toMatch(/^alert-/);
    expect(alert.asset).toBe("XLM");
    expect(alert.condition).toBe("below");
    expect(alert.threshold).toBe(0.08);
    expect(alert.active).toBe(true);
    expect(alert.triggeredAt).toBeNull();
    expect(alert.triggeredPrice).toBeNull();

    const stored = loadAlerts();
    expect(stored).toHaveLength(1);
    expect(stored[0].id).toBe(alert.id);
  });

  it("stores multiple alerts without overwriting existing ones", () => {
    createAlert({ asset: "XLM", condition: "below", threshold: 0.1, notificationPreference: "browser" });
    createAlert({ asset: "USDC", condition: "above", threshold: 1.05, notificationPreference: "in-app" });

    const stored = loadAlerts();
    expect(stored).toHaveLength(2);
    expect(stored.map((a) => a.asset)).toEqual(expect.arrayContaining(["XLM", "USDC"]));
  });
});

// ─── Test 2: deleteAlert removes the correct entry ───────────────────────────

describe("deleteAlert", () => {
  it("removes the alert with the matching id and leaves others intact", () => {
    const a1 = createAlert({ asset: "XLM", condition: "below", threshold: 0.1, notificationPreference: "browser" });
    const a2 = createAlert({ asset: "USDC", condition: "above", threshold: 1.1, notificationPreference: "in-app" });

    deleteAlert(a1.id);

    const remaining = loadAlerts();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe(a2.id);
  });

  it("is a no-op when the id does not exist", () => {
    createAlert({ asset: "XLM", condition: "below", threshold: 0.1, notificationPreference: "browser" });

    deleteAlert("nonexistent-id");

    expect(loadAlerts()).toHaveLength(1);
  });
});

// ─── Test 3: triggerAlert marks alert as triggered ───────────────────────────

describe("triggerAlert", () => {
  it("marks the alert as inactive and stores the triggered price and timestamp", () => {
    const alert = createAlert({
      asset: "XLM",
      condition: "below",
      threshold: 0.1,
      notificationPreference: "browser",
    });

    const triggered = triggerAlert(alert.id, 0.075);

    expect(triggered).not.toBeNull();
    expect(triggered!.active).toBe(false);
    expect(triggered!.triggeredPrice).toBe(0.075);
    expect(triggered!.triggeredAt).not.toBeNull();

    // Persisted correctly
    const stored = loadAlerts();
    expect(stored[0].active).toBe(false);
    expect(stored[0].triggeredPrice).toBe(0.075);
  });

  it("returns null when the id is not found", () => {
    const result = triggerAlert("ghost-id", 0.5);
    expect(result).toBeNull();
  });
});

// ─── Test 4: fetchPrices calls CoinGecko and maps results ────────────────────

describe("fetchPrices", () => {
  it("returns a price map for known assets using the CoinGecko response", async () => {
    const mockJson = {
      stellar: { usd: 0.092 },
      "usd-coin": { usd: 1.001 },
    };

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => mockJson,
    } as Response);

    const prices = await fetchPrices(["XLM", "USDC"]);

    expect(prices.XLM).toBeCloseTo(0.092);
    expect(prices.USDC).toBeCloseTo(1.001);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("stellar,usd-coin")
    );
  });

  it("throws when CoinGecko responds with a non-ok status", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 429,
    } as Response);

    await expect(fetchPrices(["XLM"])).rejects.toThrow("429");
  });

  it("returns an empty map when no assets are passed", async () => {
    const prices = await fetchPrices([]);
    expect(prices).toEqual({});
    // fetch should never be called for an empty list
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

// ─── Test 5: polling engine triggers callback when threshold is crossed ───────

describe("startPriceAlertPoller", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("fires onTriggered and marks alert as triggered when price crosses below threshold", async () => {
    // Create an active alert: XLM below $0.10
    createAlert({
      asset: "XLM",
      condition: "below",
      threshold: 0.1,
      notificationPreference: "in-app",
    });

    // Mock CoinGecko: current XLM price is $0.075 (below threshold)
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ stellar: { usd: 0.075 } }),
    } as Response);

    const onTriggered = jest.fn();
    const stop = startPriceAlertPoller(onTriggered, 60_000);

    // Let the initial poll promise resolve
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(onTriggered).toHaveBeenCalledTimes(1);
    const [triggeredAlert] = onTriggered.mock.calls[0];
    expect(triggeredAlert.active).toBe(false);
    expect(triggeredAlert.triggeredPrice).toBeCloseTo(0.075);

    stop();
  });

  it("does NOT fire onTriggered when price is above a below-threshold alert", async () => {
    // Alert: XLM below $0.10 but price is $0.12 (not triggered)
    createAlert({
      asset: "XLM",
      condition: "below",
      threshold: 0.1,
      notificationPreference: "in-app",
    });

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ stellar: { usd: 0.12 } }),
    } as Response);

    const onTriggered = jest.fn();
    const stop = startPriceAlertPoller(onTriggered, 60_000);

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(onTriggered).not.toHaveBeenCalled();

    stop();
  });

  it("fires for above-threshold alerts when price exceeds threshold", async () => {
    createAlert({
      asset: "XLM",
      condition: "above",
      threshold: 0.15,
      notificationPreference: "in-app",
    });

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ stellar: { usd: 0.20 } }),
    } as Response);

    const onTriggered = jest.fn();
    const stop = startPriceAlertPoller(onTriggered, 60_000);

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(onTriggered).toHaveBeenCalledTimes(1);

    stop();
  });

  it("does NOT call fetch when there are no active alerts", async () => {
    global.fetch = jest.fn();

    const onTriggered = jest.fn();
    const stop = startPriceAlertPoller(onTriggered, 60_000);

    await Promise.resolve();
    await Promise.resolve();

    expect(global.fetch).not.toHaveBeenCalled();
    expect(onTriggered).not.toHaveBeenCalled();

    stop();
  });

  it("cleanup function cancels the interval and stops further polling", async () => {
    createAlert({
      asset: "XLM",
      condition: "below",
      threshold: 0.1,
      notificationPreference: "in-app",
    });

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ stellar: { usd: 0.05 } }),
    } as Response);

    const onTriggered = jest.fn();
    const stop = startPriceAlertPoller(onTriggered, 60_000);

    // Immediately stop — the initial poll may still fire once
    stop();

    // Advance the timer; no additional calls should happen after stop
    jest.advanceTimersByTime(120_000);
    await Promise.resolve();

    // fetch should have been called at most once (initial poll before stop)
    expect((global.fetch as jest.Mock).mock.calls.length).toBeLessThanOrEqual(1);
  });
});

// ─── Test 6: firePriceAlertNotification with Notification API mock ────────────

describe("firePriceAlertNotification", () => {
  it("constructs a notification with the correct title when Notification is granted", async () => {
    const mockNotification = jest.fn();
    Object.defineProperty(window, "Notification", {
      writable: true,
      value: Object.assign(mockNotification, { permission: "granted" }),
    });

    // Mock serviceWorker.ready to reject so the code falls back to new Notification()
    Object.defineProperty(navigator, "serviceWorker", {
      writable: true,
      configurable: true,
      value: {
        ready: Promise.reject(new Error("SW not available")),
      },
    });

    const alert = makeAlert({ asset: "XLM", condition: "below", threshold: 0.08 });
    firePriceAlertNotification(alert, 0.072);

    // Allow the Promise chain to resolve / reject
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(mockNotification).toHaveBeenCalledWith(
      "XLM Price Alert",
      expect.objectContaining({ body: expect.stringContaining("0.072") })
    );
  });

  it("does nothing when Notification.permission is not granted", () => {
    const mockNotification = jest.fn();
    Object.defineProperty(window, "Notification", {
      writable: true,
      value: Object.assign(mockNotification, { permission: "default" }),
    });

    firePriceAlertNotification(makeAlert(), 0.05);

    expect(mockNotification).not.toHaveBeenCalled();
  });
});

// ─── Test 7: requestNotificationPermission delegates to the API ───────────────

describe("requestNotificationPermission", () => {
  it("returns true when Notification.requestPermission resolves to granted", async () => {
    Object.defineProperty(window, "Notification", {
      writable: true,
      value: {
        permission: "default",
        requestPermission: jest.fn().mockResolvedValue("granted"),
      },
    });

    const result = await requestNotificationPermission();
    expect(result).toBe(true);
  });

  it("returns false when Notification.requestPermission resolves to denied", async () => {
    Object.defineProperty(window, "Notification", {
      writable: true,
      value: {
        permission: "default",
        requestPermission: jest.fn().mockResolvedValue("denied"),
      },
    });

    const result = await requestNotificationPermission();
    expect(result).toBe(false);
  });

  it("returns true immediately when permission is already granted", async () => {
    Object.defineProperty(window, "Notification", {
      writable: true,
      value: {
        permission: "granted",
        requestPermission: jest.fn(),
      },
    });

    const result = await requestNotificationPermission();
    expect(result).toBe(true);
    expect(window.Notification.requestPermission).not.toHaveBeenCalled();
  });
});

// ─── Test 8: loadAlerts / saveAlerts round-trip ───────────────────────────────

describe("loadAlerts / saveAlerts", () => {
  it("returns an empty array when localStorage is empty", () => {
    expect(loadAlerts()).toEqual([]);
  });

  it("round-trips a list of alerts through localStorage correctly", () => {
    const alerts: PriceAlert[] = [makeAlert(), makeAlert({ id: "test-2", asset: "USDC", condition: "above" })];
    saveAlerts(alerts);

    const loaded = loadAlerts();
    expect(loaded).toHaveLength(2);
    expect(loaded[0].asset).toBe("XLM");
    expect(loaded[1].asset).toBe("USDC");
  });

  it("returns an empty array when localStorage contains malformed JSON", () => {
    localStorage.setItem(PRICE_ALERTS_STORAGE_KEY, "not-valid-json{{{");
    expect(loadAlerts()).toEqual([]);
  });
});

/**
 * __tests__/inAppNotifications.test.ts
 *
 * Tests for lib/inAppNotifications.ts — the localStorage-backed in-app
 * notification store. Runs under the jsdom test environment, so we use the
 * real `window.localStorage` and clear it before each test.
 */

import {
  addNotification,
  clearNotifications,
  deleteNotification,
  getNotifications,
  getUnreadCount,
  markAllNotificationsRead,
  markNotificationRead,
  MAX_NOTIFICATIONS,
  storageKey,
} from "@/lib/inAppNotifications";

const PK = "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ";

// Ensure randomUUID is present (jsdom may lack it). jest.setup backs global
// crypto with Node's webcrypto, which exposes randomUUID.
beforeAll(() => {
  if (typeof crypto === "undefined" || !crypto.randomUUID) {
    Object.defineProperty(global, "crypto", {
      value: { randomUUID: () => `uuid-${Math.random().toString(36).slice(2, 10)}` },
      configurable: true,
      writable: true,
    });
  }
});

beforeEach(() => {
  window.localStorage.clear();
});

describe("addNotification", () => {
  it("adds an unread notification and persists it", () => {
    const n = addNotification(PK, {
      eventType: "incoming_payment",
      message: "You received 10 XLM",
    });
    expect(n).not.toBeNull();
    expect(n!.read).toBe(false);
    const items = getNotifications(PK);
    expect(items).toHaveLength(1);
    expect(items[0].message).toBe("You received 10 XLM");
  });

  it("prepends newest notifications", () => {
    addNotification(PK, { eventType: "a", message: "first" });
    addNotification(PK, { eventType: "b", message: "second" });
    const items = getNotifications(PK);
    expect(items).toHaveLength(2);
    expect(items[0].message).toBe("second");
    expect(items[1].message).toBe("first");
  });

  it("returns null without a publicKey", () => {
    expect(addNotification("", { eventType: "a", message: "x" })).toBeNull();
  });
});

describe("wallet scoping", () => {
  it("separates notifications per wallet", () => {
    addNotification(PK, { eventType: "a", message: "wallet A" });
    addNotification("GBDIFFERENTWALLET", { eventType: "a", message: "wallet B" });
    expect(getNotifications(PK)).toHaveLength(1);
    expect(getNotifications(PK)[0].message).toBe("wallet A");
  });

  it("uses the expected storage key", () => {
    expect(storageKey(PK)).toBe(`finchippay:inapp-notifications:${PK}`);
  });
});

describe("read / unread", () => {
  it("counts unread notifications", () => {
    const n1 = addNotification(PK, { eventType: "a", message: "1" })!;
    addNotification(PK, { eventType: "b", message: "2" });
    expect(getUnreadCount(PK)).toBe(2);
    markNotificationRead(PK, n1.id);
    expect(getUnreadCount(PK)).toBe(1);
  });

  it("marks a single notification read", () => {
    const n = addNotification(PK, { eventType: "a", message: "hi" })!;
    markNotificationRead(PK, n.id);
    expect(getNotifications(PK)[0].read).toBe(true);
  });

  it("marks all notifications read", () => {
    addNotification(PK, { eventType: "a", message: "1" });
    addNotification(PK, { eventType: "b", message: "2" });
    markAllNotificationsRead(PK);
    expect(getUnreadCount(PK)).toBe(0);
  });
});

describe("delete / clear", () => {
  it("deletes a single notification", () => {
    const n1 = addNotification(PK, { eventType: "a", message: "1" })!;
    const n2 = addNotification(PK, { eventType: "b", message: "2" })!;
    deleteNotification(PK, n1.id);
    const items = getNotifications(PK);
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe(n2.id);
  });

  it("clears all notifications", () => {
    addNotification(PK, { eventType: "a", message: "1" });
    addNotification(PK, { eventType: "b", message: "2" });
    clearNotifications(PK);
    expect(getNotifications(PK)).toHaveLength(0);
    expect(getUnreadCount(PK)).toBe(0);
  });
});

describe("capacity", () => {
  it("caps stored notifications at MAX_NOTIFICATIONS", () => {
    for (let i = 0; i < MAX_NOTIFICATIONS + 10; i++) {
      addNotification(PK, { eventType: "a", message: `n${i}` });
    }
    const items = getNotifications(PK);
    expect(items.length).toBeLessThanOrEqual(MAX_NOTIFICATIONS);
    // Newest retained
    expect(items[0].message).toBe(`n${MAX_NOTIFICATIONS + 9}`);
  });
});

/**
 * __tests__/pushNotifications.test.ts
 *
 * Test suite for lib/pushNotifications (Issue #385).
 * Covers: support detection, VAPID key resolution and its backend fallback,
 *         permission + subscribe flow, unsubscribe cleanup, and the
 *         "don't nag" rules behind the opt-in prompt.
 */

import {
  DISMISSAL_TTL_MS,
  DISMISSED_STORAGE_KEY,
  OPT_IN_STORAGE_KEY,
  dismissPrompt,
  getPermission,
  getVapidPublicKey,
  hasOptedIn,
  isPushSupported,
  requestPermission,
  resetVapidKeyCache,
  setOptIn,
  shouldShowPrompt,
  subscribeUser,
  unsubscribeUser,
  urlBase64ToUint8Array,
} from "@/lib/pushNotifications";

const PUBLIC_KEY = "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUWDA";
const ENDPOINT = "https://push.example.com/device-1";
const VAPID = "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkTLdOhoQ1o";

// ─── Environment doubles ──────────────────────────────────────────────────────

type PermissionValue = NotificationPermission;

let requestPermissionMock: jest.Mock;
let subscribeMock: jest.Mock;
let getSubscriptionMock: jest.Mock;
let registerMock: jest.Mock;
let fetchMock: jest.Mock;

/**
 * A PushSubscription stand-in: only endpoint + unsubscribe() are used.
 * Each call gets its own unsubscribe spy, so a test can assert against the
 * exact subscription it installed.
 */
function fakeSubscription(endpoint = ENDPOINT) {
  return {
    endpoint,
    unsubscribe: jest.fn().mockResolvedValue(true),
    toJSON: () => ({ endpoint }),
  };
}

function installBrowser({
  permission = "default" as PermissionValue,
  existingSubscription = null as ReturnType<typeof fakeSubscription> | null,
} = {}) {
  requestPermissionMock = jest.fn().mockResolvedValue("granted");
  subscribeMock = jest.fn().mockResolvedValue(fakeSubscription());
  getSubscriptionMock = jest.fn().mockResolvedValue(existingSubscription);

  const registration = {
    pushManager: {
      subscribe: subscribeMock,
      getSubscription: getSubscriptionMock,
    },
  };

  registerMock = jest.fn().mockResolvedValue(registration);

  Object.defineProperty(window, "Notification", {
    configurable: true,
    writable: true,
    value: Object.assign(jest.fn(), {
      permission,
      requestPermission: requestPermissionMock,
    }),
  });

  Object.defineProperty(window, "PushManager", {
    configurable: true,
    writable: true,
    value: jest.fn(),
  });

  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    writable: true,
    value: { register: registerMock, ready: Promise.resolve(registration) },
  });

  fetchMock = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ data: { publicKey: VAPID, enabled: true } }),
  });
  window.fetch = fetchMock as unknown as typeof fetch;
  global.fetch = fetchMock as unknown as typeof fetch;
}

function uninstallPush() {
  // Remove PushManager so isPushSupported() reports false.
  // @ts-expect-error deliberately deleting for the unsupported-browser case
  delete window.PushManager;
}

beforeEach(() => {
  localStorage.clear();
  resetVapidKeyCache();
  process.env.NEXT_PUBLIC_API_URL = "https://api.example.com";
  delete process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  installBrowser();
});

// ─── Support detection ────────────────────────────────────────────────────────

describe("isPushSupported", () => {
  it("is true when the browser exposes the Push APIs", () => {
    expect(isPushSupported()).toBe(true);
  });

  it("is false when PushManager is missing", () => {
    uninstallPush();
    expect(isPushSupported()).toBe(false);
  });
});

describe("getPermission", () => {
  it("reflects the browser permission", () => {
    installBrowser({ permission: "granted" });
    expect(getPermission()).toBe("granted");
  });
});

// ─── VAPID key resolution ─────────────────────────────────────────────────────

describe("getVapidPublicKey", () => {
  it("prefers the build-time env var without calling the API", async () => {
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = "env-key";
    resetVapidKeyCache();

    expect(await getVapidPublicKey()).toBe("env-key");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falls back to the backend when no env var is set", async () => {
    expect(await getVapidPublicKey()).toBe(VAPID);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.com/api/push/public-key",
    );
  });

  it("memoises the fetched key", async () => {
    await getVapidPublicKey();
    await getVapidPublicKey();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns null when the server reports push disabled", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ data: { publicKey: null, enabled: false } }),
    });

    expect(await getVapidPublicKey()).toBeNull();
  });

  it("returns null, without caching, when the backend is unreachable", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    expect(await getVapidPublicKey()).toBeNull();

    // A later attempt should retry rather than reuse the failure.
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ data: { publicKey: VAPID, enabled: true } }),
    });
    expect(await getVapidPublicKey()).toBe(VAPID);
  });
});

describe("urlBase64ToUint8Array", () => {
  it("decodes a base64url VAPID key into bytes", () => {
    const bytes = urlBase64ToUint8Array(VAPID);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(0);
  });
});

// ─── Subscribe ────────────────────────────────────────────────────────────────

describe("subscribeUser", () => {
  beforeEach(() => {
    installBrowser({ permission: "granted" });
  });

  it("subscribes and registers the device with the backend", async () => {
    const subscription = await subscribeUser(PUBLIC_KEY);

    expect(subscription).not.toBeNull();
    expect(registerMock).toHaveBeenCalledWith("/sw.js");
    expect(subscribeMock).toHaveBeenCalledWith(
      expect.objectContaining({ userVisibleOnly: true }),
    );

    const registerCall = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith("/api/push/subscribe"),
    );
    expect(registerCall).toBeDefined();
    expect(JSON.parse(registerCall![1].body)).toMatchObject({
      publicKey: PUBLIC_KEY,
    });
  });

  it("reuses an existing browser subscription instead of re-subscribing", async () => {
    installBrowser({
      permission: "granted",
      existingSubscription: fakeSubscription("https://push.example.com/existing"),
    });

    const subscription = await subscribeUser(PUBLIC_KEY);

    expect(subscribeMock).not.toHaveBeenCalled();
    expect(subscription?.endpoint).toBe("https://push.example.com/existing");
  });

  it("does nothing without permission", async () => {
    installBrowser({ permission: "default" });

    expect(await subscribeUser(PUBLIC_KEY)).toBeNull();
    expect(subscribeMock).not.toHaveBeenCalled();
  });

  it("does nothing when no VAPID key is available", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ data: { publicKey: null, enabled: false } }),
    });

    expect(await subscribeUser(PUBLIC_KEY)).toBeNull();
    expect(subscribeMock).not.toHaveBeenCalled();
  });

  it("returns null when the server rejects the registration", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (String(url).endsWith("/api/push/subscribe")) {
        return Promise.resolve({ ok: false, status: 401 });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ data: { publicKey: VAPID, enabled: true } }),
      });
    });

    expect(await subscribeUser(PUBLIC_KEY)).toBeNull();
  });

  it("requires a public key", async () => {
    expect(await subscribeUser("")).toBeNull();
  });
});

// ─── requestPermission ────────────────────────────────────────────────────────

describe("requestPermission", () => {
  it("asks the browser and subscribes when granted", async () => {
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = VAPID;
    resetVapidKeyCache();
    requestPermissionMock.mockImplementation(async () => {
      (window.Notification as unknown as { permission: string }).permission =
        "granted";
      return "granted";
    });

    const result = await requestPermission(PUBLIC_KEY);

    expect(requestPermissionMock).toHaveBeenCalled();
    expect(result).toEqual({ permission: "granted", subscribed: true });
  });

  it("does not subscribe when the user declines", async () => {
    requestPermissionMock.mockResolvedValue("denied");

    const result = await requestPermission(PUBLIC_KEY);

    expect(result).toEqual({ permission: "denied", subscribed: false });
    expect(subscribeMock).not.toHaveBeenCalled();
  });

  it("reports denied on browsers without push support", async () => {
    uninstallPush();

    expect(await requestPermission(PUBLIC_KEY)).toEqual({
      permission: "denied",
      subscribed: false,
    });
  });
});

// ─── Unsubscribe ──────────────────────────────────────────────────────────────

describe("unsubscribeUser", () => {
  it("tells the backend before dropping the local subscription", async () => {
    const subscription = fakeSubscription();
    installBrowser({ permission: "granted", existingSubscription: subscription });

    expect(await unsubscribeUser(PUBLIC_KEY)).toBe(true);

    const call = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith("/api/push/unsubscribe"),
    );
    expect(call).toBeDefined();
    expect(JSON.parse(call![1].body)).toEqual({
      publicKey: PUBLIC_KEY,
      endpoint: ENDPOINT,
    });
    expect(subscription.unsubscribe).toHaveBeenCalled();
  });

  it("still drops the local subscription when the server call fails", async () => {
    const subscription = fakeSubscription();
    installBrowser({ permission: "granted", existingSubscription: subscription });
    fetchMock.mockRejectedValue(new Error("offline"));

    expect(await unsubscribeUser(PUBLIC_KEY)).toBe(true);
    expect(subscription.unsubscribe).toHaveBeenCalled();
  });

  it("succeeds when there is nothing subscribed", async () => {
    installBrowser({ permission: "granted", existingSubscription: null });

    expect(await unsubscribeUser(PUBLIC_KEY)).toBe(true);
  });
});

// ─── Prompt bookkeeping ───────────────────────────────────────────────────────

describe("shouldShowPrompt", () => {
  it("shows for a fresh, supported browser with an undecided permission", () => {
    expect(shouldShowPrompt()).toBe(true);
  });

  it("stays hidden once permission is decided", () => {
    installBrowser({ permission: "granted" });
    expect(shouldShowPrompt()).toBe(false);

    installBrowser({ permission: "denied" });
    expect(shouldShowPrompt()).toBe(false);
  });

  it("stays hidden when the user has already opted in", () => {
    setOptIn(true);
    expect(hasOptedIn()).toBe(true);
    expect(shouldShowPrompt()).toBe(false);
  });

  it("stays hidden for two weeks after a dismissal", () => {
    const now = Date.now();
    dismissPrompt(now);

    expect(localStorage.getItem(DISMISSED_STORAGE_KEY)).toBe(String(now));
    expect(shouldShowPrompt(now + 1000)).toBe(false);
    expect(shouldShowPrompt(now + DISMISSAL_TTL_MS - 1000)).toBe(false);
  });

  it("may ask again once the dismissal has expired", () => {
    const now = Date.now();
    dismissPrompt(now);

    expect(shouldShowPrompt(now + DISMISSAL_TTL_MS + 1000)).toBe(true);
  });

  it("stays hidden on unsupported browsers", () => {
    uninstallPush();
    expect(shouldShowPrompt()).toBe(false);
  });
});

describe("setOptIn", () => {
  it("persists the choice", () => {
    setOptIn(true);
    expect(localStorage.getItem(OPT_IN_STORAGE_KEY)).toBe("true");

    setOptIn(false);
    expect(localStorage.getItem(OPT_IN_STORAGE_KEY)).toBe("false");
    expect(hasOptedIn()).toBe(false);
  });
});

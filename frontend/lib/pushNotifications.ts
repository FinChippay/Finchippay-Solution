/**
 * lib/pushNotifications.ts
 * Web Push subscription management for the PWA.
 *
 * Single home for the Push API flow, which previously lived inline in
 * pages/dashboard.tsx. Centralising it matters for two reasons beyond
 * duplication: the server registration call needs the SEP-10 bearer token
 * (push routes are owner-scoped), and the VAPID key needs a fallback for
 * deployments that configure it on the backend only.
 *
 * Reference: https://developer.mozilla.org/en-US/docs/Web/API/Push_API
 */

import { withAuth } from "@/lib/auth";

/** Where the browser remembers the user's answer to the prompt. */
export const OPT_IN_STORAGE_KEY = "notificationOptIn";

/** Set when the user chooses "Not Now", so the prompt does not nag. */
export const DISMISSED_STORAGE_KEY = "notificationPromptDismissedAt";

/** How long "Not Now" suppresses the prompt. */
export const DISMISSAL_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

const apiBase = (): string =>
  (process.env.NEXT_PUBLIC_API_URL || "").replace(/\/+$/, "");

/**
 * Whether this browser can do Web Push at all.
 *
 * Checked before showing any UI: Safari below 16.4, Firefox in private
 * browsing, and most in-app browsers lack one of these.
 */
export function isPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/** Current permission, or "default" where the API is unavailable. */
export function getPermission(): NotificationPermission {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return "default";
  }
  return Notification.permission;
}

/**
 * Convert a base64url VAPID key into the Uint8Array applicationServerKey
 * expects. Browsers reject the string form.
 */
export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) {
    output[i] = raw.charCodeAt(i);
  }
  return output;
}

let cachedVapidKey: string | null | undefined;

/**
 * The VAPID public key to subscribe with.
 *
 * Prefers the build-time env var, then asks the backend. The fallback keeps a
 * frontend deploy from needing a rebuild when keys are rotated server-side, and
 * returns null when push is not configured at all so callers can stay silent
 * rather than prompting for a permission nothing will use.
 */
export async function getVapidPublicKey(): Promise<string | null> {
  if (cachedVapidKey !== undefined) return cachedVapidKey;

  const fromEnv = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (fromEnv) {
    cachedVapidKey = fromEnv;
    return cachedVapidKey;
  }

  try {
    const res = await fetch(`${apiBase()}/api/push/public-key`);
    if (!res.ok) {
      cachedVapidKey = null;
      return cachedVapidKey;
    }
    const body = await res.json();
    cachedVapidKey = body?.data?.enabled
      ? (body.data.publicKey as string | undefined) ?? null
      : null;
  } catch {
    // Backend unreachable — treat push as unavailable for now, but do not
    // cache the failure so a later attempt can succeed.
    return null;
  }

  return cachedVapidKey ?? null;
}

/** Test seam: clear the memoised VAPID key. */
export function resetVapidKeyCache(): void {
  cachedVapidKey = undefined;
}

/** Register the service worker, reusing an existing registration. */
async function getRegistration(): Promise<ServiceWorkerRegistration> {
  return navigator.serviceWorker.register("/sw.js");
}

/**
 * Ask for notification permission, and subscribe when it is granted.
 *
 * Must be called from a user gesture: some browsers silently reject
 * `Notification.requestPermission()` outside one.
 *
 * @param publicKey Account the subscription belongs to.
 */
export async function requestPermission(
  publicKey?: string,
): Promise<{ permission: NotificationPermission; subscribed: boolean }> {
  if (!isPushSupported()) {
    return { permission: "denied", subscribed: false };
  }

  const permission = await Notification.requestPermission();

  if (permission !== "granted") {
    return { permission, subscribed: false };
  }

  const subscription = publicKey ? await subscribeUser(publicKey) : null;
  return { permission, subscribed: Boolean(subscription) };
}

/**
 * Subscribe this browser to push and register it with the backend.
 *
 * Returns null when push is unsupported, unconfigured, or the server rejects
 * the registration; callers should treat null as "notifications are not on"
 * rather than as an exception path.
 */
export async function subscribeUser(
  publicKey: string,
): Promise<PushSubscription | null> {
  if (!isPushSupported() || !publicKey) return null;
  if (getPermission() !== "granted") return null;

  const vapidPublicKey = await getVapidPublicKey();
  if (!vapidPublicKey) return null;

  const registration = await getRegistration();

  // Reuse the existing subscription when there is one: re-subscribing an
  // endpoint the browser already holds is wasteful and can rotate keys the
  // backend has stored.
  const existing = await registration.pushManager.getSubscription();
  const subscription =
    existing ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      // Cast because lib.dom types applicationServerKey as BufferSource, while
      // TypeScript infers Uint8Array<ArrayBufferLike> from the decoder.
      applicationServerKey: urlBase64ToUint8Array(
        vapidPublicKey,
      ) as BufferSource,
    }));

  const authedFetch = withAuth(window.fetch.bind(window));

  try {
    const res = await authedFetch(`${apiBase()}/api/push/subscribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ publicKey, subscription }),
    });

    if (!res.ok) {
      // Leave the browser subscription in place: the user granted permission,
      // and a later attempt can register it once the session is authenticated.
      return null;
    }
  } catch {
    return null;
  }

  return subscription;
}

/**
 * Remove this browser's subscription, server-side and locally.
 *
 * The server call goes first so a failure there does not leave the backend
 * pushing to an endpoint the browser has already discarded.
 */
export async function unsubscribeUser(publicKey: string): Promise<boolean> {
  if (!isPushSupported()) return false;

  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();

  if (!subscription) return true;

  const authedFetch = withAuth(window.fetch.bind(window));

  try {
    await authedFetch(`${apiBase()}/api/push/unsubscribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ publicKey, endpoint: subscription.endpoint }),
    });
  } catch {
    // Fall through: still drop the local subscription so the user's choice
    // takes effect immediately. Dead endpoints are pruned server-side on the
    // next send.
  }

  return subscription.unsubscribe();
}

// ─── Prompt bookkeeping ───────────────────────────────────────────────────────

/** Whether the user has opted in on this device. */
export function hasOptedIn(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(OPT_IN_STORAGE_KEY) === "true";
}

export function setOptIn(optedIn: boolean): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(OPT_IN_STORAGE_KEY, optedIn ? "true" : "false");
}

/** Record a "Not Now" so the prompt stays away for DISMISSAL_TTL_MS. */
export function dismissPrompt(now: number = Date.now()): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(DISMISSED_STORAGE_KEY, String(now));
}

/**
 * Whether the prompt should be shown.
 *
 * False when push is unsupported, permission is already decided, the user is
 * opted in, or they dismissed it recently — the issue asks for a prompt that
 * respects the user's choice and does not nag.
 */
export function shouldShowPrompt(now: number = Date.now()): boolean {
  if (!isPushSupported()) return false;
  if (getPermission() !== "default") return false;
  if (hasOptedIn()) return false;

  const dismissedAt = Number(
    window.localStorage.getItem(DISMISSED_STORAGE_KEY) || 0,
  );

  if (!dismissedAt) return true;
  return now - dismissedAt > DISMISSAL_TTL_MS;
}

/**
 * lib/pushNotifications.ts
 * Web Push subscription helpers for Finchippay.
 *
 * Provides requestPermission, subscribeUser, and unsubscribeUser.
 * Relies on NEXT_PUBLIC_VAPID_PUBLIC_KEY and NEXT_PUBLIC_API_URL env vars.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "";
const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

/** Convert a base64url VAPID public key to a Uint8Array expected by the Push API. */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
}

/**
 * Request notification permission from the user.
 * Returns the resulting permission state: "granted" | "denied" | "default".
 */
export async function requestPermission(): Promise<NotificationPermission> {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return "denied";
  }
  if (Notification.permission === "granted") return "granted";
  return Notification.requestPermission();
}

/**
 * Subscribe the current browser to push notifications and register the
 * subscription with the backend, keyed by the user's Stellar public key.
 *
 * @param stellarPublicKey - The connected wallet's public key
 * @returns The PushSubscription if successful, null otherwise
 */
export async function subscribeUser(
  stellarPublicKey: string
): Promise<PushSubscription | null> {
  if (typeof window === "undefined") return null;

  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    console.warn("[Push] Push API not supported in this browser.");
    return null;
  }

  if (!VAPID_PUBLIC_KEY) {
    console.warn("[Push] NEXT_PUBLIC_VAPID_PUBLIC_KEY is not set.");
    return null;
  }

  try {
    const registration = await navigator.serviceWorker.ready;

    // Check for an existing subscription first
    const existing = await registration.pushManager.getSubscription();
    if (existing) {
      // Re-send to backend in case it was previously removed
      await sendSubscriptionToServer(stellarPublicKey, existing);
      return existing;
    }

    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });

    await sendSubscriptionToServer(stellarPublicKey, subscription);
    return subscription;
  } catch (err) {
    console.error("[Push] Failed to subscribe:", err);
    return null;
  }
}

/**
 * Unsubscribe the current browser from push notifications and remove the
 * subscription from the backend.
 *
 * @param stellarPublicKey - The connected wallet's public key
 */
export async function unsubscribeUser(stellarPublicKey: string): Promise<void> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) return;

    await removeSubscriptionFromServer(stellarPublicKey, subscription.endpoint);
    await subscription.unsubscribe();
  } catch (err) {
    console.error("[Push] Failed to unsubscribe:", err);
  }
}

/** Returns true if the current browser is already subscribed. */
export async function isSubscribed(): Promise<boolean> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
    return false;
  }
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    return subscription !== null;
  } catch {
    return false;
  }
}

// ─── Private helpers ──────────────────────────────────────────────────────────

async function sendSubscriptionToServer(
  stellarPublicKey: string,
  subscription: PushSubscription
): Promise<void> {
  const res = await fetch(`${API_URL}/api/push/subscribe`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ publicKey: stellarPublicKey, subscription }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`[Push] Backend subscription failed: ${res.status} ${text}`);
  }
}

async function removeSubscriptionFromServer(
  stellarPublicKey: string,
  endpoint: string
): Promise<void> {
  const res = await fetch(`${API_URL}/api/push/unsubscribe`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ publicKey: stellarPublicKey, endpoint }),
  });

  if (!res.ok) {
    console.warn("[Push] Backend unsubscription failed:", res.status);
  }
}

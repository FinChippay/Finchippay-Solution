/**
 * lib/inAppNotifications.ts
 *
 * Local-first in-app notification store.
 *
 * The app already has web-push and server-side notification history, but
 * there is no client-side inbox that survives a session. This module provides
 * a lightweight, wallet-scoped notification inbox persisted to localStorage
 * so users can view, mark-as-read, filter and delete notifications without
 * depending on network availability.
 *
 * Design decisions:
 *  - Wallet-scoped key (`finchippay:inapp-notifications:<publicKey>`) so
 *    switching accounts never leaks one wallet's notifications into another.
 *  - Pure functions + a tiny read/write layer keep the store trivially
 *    unit-testable with a mocked localStorage.
 *  - A window CustomEvent (`finchippay:notifications-changed`) lets the
 *    Navbar badge, the dropdown and the full page stay in sync without
 *    prop-drilling.
 *  - Capped at MAX_NOTIFICATIONS (50) — oldest are trimmed first, matching
 *    the "show last 50 notifications" acceptance criterion.
 */

export interface InAppNotification {
  /** Stable unique id (UUID string). */
  id: string;
  /** Event type, e.g. "incoming_payment", "escrow_release", "price_alert". */
  eventType: string;
  /** Human-readable message shown to the user. */
  message: string;
  /** Whether the user has seen/dismissed this notification. */
  read: boolean;
  /** ISO timestamp when the notification was created. */
  createdAt: string;
  /** Optional route to deep-link to (e.g. "/transactions", "/escrow"). */
  deepLink?: string | null;
}

export const MAX_NOTIFICATIONS = 50;

/** Window event dispatched whenever the store mutates. */
export const NOTIFICATIONS_CHANGED_EVENT = "finchippay:notifications-changed";

const STORAGE_PREFIX = "finchippay:inapp-notifications:";

export function storageKey(publicKey: string): string {
  return `${STORAGE_PREFIX}${publicKey}`;
}

export function generateId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * Read all notifications for a wallet, newest-first.
 * Returns [] when unavailable (SSR, no localStorage, or no publicKey).
 */
export function getNotifications(publicKey: string): InAppNotification[] {
  if (typeof window === "undefined" || !publicKey) return [];
  try {
    const raw = window.localStorage.getItem(storageKey(publicKey));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as InAppNotification[];
  } catch {
    return [];
  }
}

function writeNotifications(publicKey: string, items: InAppNotification[]): void {
  if (typeof window === "undefined" || !publicKey) return;
  // Newest-first, capped at MAX_NOTIFICATIONS.
  const sorted = [...items].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
  const trimmed = sorted.slice(0, MAX_NOTIFICATIONS);
  window.localStorage.setItem(storageKey(publicKey), JSON.stringify(trimmed));
}

/** Dispatch the change event so subscribed components refresh. */
export function notifyNotificationsChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED_EVENT));
}

/**
 * Add a notification to the wallet's inbox.
 * Returns the created notification (or null when no publicKey / SSR).
 */
export function addNotification(
  publicKey: string,
  input: {
    eventType: string;
    message: string;
    deepLink?: string | null;
  },
): InAppNotification | null {
  if (!publicKey) return null;
  const notification: InAppNotification = {
    id: generateId(),
    eventType: input.eventType,
    message: input.message,
    read: false,
    createdAt: new Date().toISOString(),
    deepLink: input.deepLink ?? null,
  };
  const items = getNotifications(publicKey);
  writeNotifications(publicKey, [notification, ...items]);
  notifyNotificationsChanged();
  return notification;
}

/** Number of unread notifications for a wallet. */
export function getUnreadCount(publicKey: string): number {
  return getNotifications(publicKey).filter((n) => !n.read).length;
}

/** Mark a single notification as read. */
export function markNotificationRead(publicKey: string, id: string): void {
  const items = getNotifications(publicKey).map((n) =>
    n.id === id ? { ...n, read: true } : n,
  );
  writeNotifications(publicKey, items);
  notifyNotificationsChanged();
}

/** Mark every notification for a wallet as read. */
export function markAllNotificationsRead(publicKey: string): void {
  const items = getNotifications(publicKey).map((n) => ({ ...n, read: true }));
  writeNotifications(publicKey, items);
  notifyNotificationsChanged();
}

/** Delete a single notification. */
export function deleteNotification(publicKey: string, id: string): void {
  const items = getNotifications(publicKey).filter((n) => n.id !== id);
  writeNotifications(publicKey, items);
  notifyNotificationsChanged();
}

/** Remove all notifications for a wallet. */
export function clearNotifications(publicKey: string): void {
  if (typeof window === "undefined" || !publicKey) return;
  window.localStorage.removeItem(storageKey(publicKey));
  notifyNotificationsChanged();
}

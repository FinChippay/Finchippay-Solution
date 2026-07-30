/**
 * lib/announce.ts
 * Minimal pub-sub used to push messages into the screen-reader-only live
 * region rendered by components/ScreenReaderAnnouncements.tsx. Any part of
 * the app (payment flows, forms, route changes) can call `announce()`
 * without needing to know where the live region lives in the tree.
 */

export type AnnouncePriority = "polite" | "assertive";

type Listener = (message: string, priority: AnnouncePriority) => void;

const listeners = new Set<Listener>();

/** Announce a message to screen readers via the app-wide live region. */
export function announce(message: string, priority: AnnouncePriority = "polite"): void {
  if (!message) return;
  listeners.forEach((listener) => listener(message, priority));
}

/** Subscribe to announcements. Returns an unsubscribe function. */
export function subscribeToAnnouncements(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

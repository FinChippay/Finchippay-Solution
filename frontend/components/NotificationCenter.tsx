/**
 * components/NotificationCenter.tsx
 * In-app notification bell + dropdown for the Navbar.
 *
 * Renders a bell icon with an unread-count badge. Clicking it opens a
 * dropdown with the most recent notifications, each of which marks itself
 * read on click and deep-links to the relevant page when available. A
 * "View all" action links to the full notifications page.
 *
 * Accessibility: the bell is a real <button> with aria-expanded and an
 * aria-label that includes the unread count; the dropdown is announced via
 * an aria-live region so screen readers hear when new notifications arrive.
 */

import clsx from "clsx";
import Link from "next/link";
import { useRouter } from "next/router";
import { useCallback, useEffect, useRef, useState } from "react";
import { BellIcon } from "@/components/icons";
import {
  getNotifications,
  getUnreadCount,
  markAllNotificationsRead,
  markNotificationRead,
  NOTIFICATIONS_CHANGED_EVENT,
  type InAppNotification,
} from "@/lib/inAppNotifications";

interface NotificationCenterProps {
  publicKey: string | null;
}

/** Map event types to a route so notifications deep-link where possible. */
export function deepLinkForEvent(eventType: string): string | null {
  switch (eventType) {
    case "incoming_payment":
    case "outgoing_payment":
      return "/transactions";
    case "escrow_release":
    case "stream_claim":
      return "/escrow";
    case "multi_sig_approval":
      return "/multi-sig-sign";
    case "price_alert":
      return "/tokens";
    case "scheduled_payment":
      return "/dashboard";
    case "contract_event":
      return "/events";
    default:
      return null;
  }
}

/** Relative time string, e.g. "2m ago", "3h ago", "5d ago". */
export function formatRelativeTime(iso: string): string {
  const d = new Date(iso);
  const now = Date.now();
  const diffMs = now - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHrs = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffMin < 1) return "now";
  if (diffMin < 60) return `${diffMin}m`;
  if (diffHrs < 24) return `${diffHrs}h`;
  if (diffDays < 7) return `${diffDays}d`;
  return d.toLocaleDateString();
}

export default function NotificationCenter({ publicKey }: NotificationCenterProps) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState<InAppNotification[]>([]);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const bellButtonRef = useRef<HTMLButtonElement>(null);

  const refresh = useCallback(() => {
    setNotifications(publicKey ? getNotifications(publicKey) : []);
  }, [publicKey]);

  useEffect(() => {
    refresh();
    window.addEventListener(NOTIFICATIONS_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(NOTIFICATIONS_CHANGED_EVENT, refresh);
  }, [refresh]);

  // Close on Escape and restore focus to the bell.
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsOpen(false);
        bellButtonRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen]);

  // Close on outside click.
  useEffect(() => {
    if (!isOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    // Defer so the same click that opened it doesn't immediately close it.
    const t = setTimeout(() => window.addEventListener("mousedown", onMouseDown), 0);
    return () => {
      clearTimeout(t);
      window.removeEventListener("mousedown", onMouseDown);
    };
  }, [isOpen]);

  const unreadCount = notifications.filter((n) => !n.read).length;
  const recent = notifications.slice(0, 5);

  const handleOpenChange = () => {
    setIsOpen((v) => !v);
  };

  const handleNotificationClick = (n: InAppNotification) => {
    if (publicKey) markNotificationRead(publicKey, n.id);
    setIsOpen(false);
    const target = n.deepLink ?? deepLinkForEvent(n.eventType);
    if (target && target !== router.pathname) {
      void router.push(target);
    }
  };

  const handleMarkAllRead = () => {
    if (publicKey) markAllNotificationsRead(publicKey);
  };

  return (
    <div className="relative" ref={dropdownRef} data-testid="notification-center">
      <button
        ref={bellButtonRef}
        onClick={handleOpenChange}
        aria-haspopup="true"
        aria-expanded={isOpen}
        aria-label={
          unreadCount > 0
            ? `${unreadCount} unread notification${unreadCount > 1 ? "s" : ""}. Open notifications.`
            : "Notifications"
        }
        className="relative flex items-center justify-center rounded-lg p-2 text-slate-500 transition-all duration-150 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-white/5 dark:hover:text-slate-200"
        data-testid="notification-bell"
      >
        <BellIcon className="h-5 w-5" />
        {unreadCount > 0 && (
          <span
            className="absolute top-0.5 right-0.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-stellar-500 px-0.5 text-[10px] font-bold text-white leading-none"
            aria-hidden="true"
            data-testid="notification-badge"
          >
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div
          className="absolute right-0 z-50 mt-2 w-80 origin-top-right rounded-xl border border-slate-200 bg-white p-3 shadow-xl dark:border-slate-700 dark:bg-cosmos-800"
          role="menu"
          aria-label="Notifications"
          data-testid="notification-dropdown"
        >
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-900 dark:text-white">Notifications</p>
            {unreadCount > 0 && (
              <button
                onClick={handleMarkAllRead}
                className="text-xs font-medium text-stellar-600 hover:text-stellar-700 dark:text-stellar-300 dark:hover:text-stellar-200"
                data-testid="mark-all-read"
              >
                Mark all read
              </button>
            )}
          </div>

          {/* aria-live announcement for new notifications */}
          <div className="sr-only" aria-live="polite" role="status">
            {unreadCount > 0
              ? `You have ${unreadCount} unread notification${unreadCount > 1 ? "s" : ""}.`
              : "No unread notifications."}
          </div>

          {notifications.length === 0 ? (
            <div className="py-8 text-center">
              <span className="mb-2 block text-3xl">🔕</span>
              <p className="text-sm text-slate-500 dark:text-slate-400">No notifications yet.</p>
            </div>
          ) : (
            <ul className="max-h-80 space-y-1 overflow-y-auto">
              {recent.map((n) => (
                <li key={n.id}>
                  <button
                    onClick={() => handleNotificationClick(n)}
                    role="menuitem"
                    className={clsx(
                      "w-full rounded-lg px-2 py-2 text-left transition-colors hover:bg-slate-50 dark:hover:bg-white/5",
                      !n.read && "bg-stellar-500/5 dark:bg-stellar-500/10",
                    )}
                    aria-label={
                      n.read
                        ? `${n.message}. ${formatRelativeTime(n.createdAt)} ago.`
                        : `${n.message}. Unread. ${formatRelativeTime(n.createdAt)} ago.`
                    }
                    data-testid={`notification-item-${n.id}`}
                  >
                    <div className="flex items-start gap-2">
                      <span className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full bg-stellar-400" aria-hidden={n.read} hidden={n.read} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-slate-800 dark:text-slate-200">{n.message}</p>
                        <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">
                          {n.eventType.replace(/_/g, " ")} · {formatRelativeTime(n.createdAt)} ago
                        </p>
                      </div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {notifications.length > 0 && (
            <div className="mt-2 border-t border-slate-100 pt-2 dark:border-slate-700">
              <Link
                href="/notifications"
                onClick={() => setIsOpen(false)}
                className="block rounded-lg px-2 py-1.5 text-center text-sm font-medium text-stellar-600 transition-colors hover:bg-slate-50 dark:text-stellar-300 dark:hover:bg-white/5"
                data-testid="view-all-notifications"
              >
                View all
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

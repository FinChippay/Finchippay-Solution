/**
 * pages/notifications.tsx
 * Full in-app notification inbox with type filters and management actions.
 *
 * Lists the wallet's notifications (newest-first) with the ability to filter
 * by event type, mark items as read, delete individual items, mark all as
 * read, or clear the whole inbox. Each notification deep-links to its
 * relevant page when one is available.
 */

import clsx from "clsx";
import Head from "next/head";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { deepLinkForEvent, formatRelativeTime } from "@/components/NotificationCenter";
import { CheckIcon, TrashIcon } from "@/components/icons";
import {
  clearNotifications,
  deleteNotification,
  getNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  NOTIFICATIONS_CHANGED_EVENT,
  type InAppNotification,
} from "@/lib/inAppNotifications";
import { useWallet } from "@/lib/useWallet";

const EVENT_FILTERS = [
  { value: "all", label: "All" },
  { value: "incoming_payment", label: "Payments" },
  { value: "escrow_release", label: "Escrow" },
  { value: "stream_claim", label: "Streams" },
  { value: "multi_sig_approval", label: "Multi-Sig" },
  { value: "price_alert", label: "Alerts" },
  { value: "contract_event", label: "Contracts" },
] as const;

export default function NotificationsPage() {
  const { publicKey } = useWallet();
  const [notifications, setNotifications] = useState<InAppNotification[]>([]);
  const [filter, setFilter] = useState<string>("all");

  const refresh = useCallback(() => {
    setNotifications(publicKey ? getNotifications(publicKey) : []);
  }, [publicKey]);

  useEffect(() => {
    refresh();
    window.addEventListener(NOTIFICATIONS_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(NOTIFICATIONS_CHANGED_EVENT, refresh);
  }, [refresh]);

  const filtered = useMemo(() => {
    if (filter === "all") return notifications;
    return notifications.filter((n) => n.eventType === filter);
  }, [notifications, filter]);

  const unreadCount = notifications.filter((n) => !n.read).length;

  const handleMarkRead = (id: string) => {
    if (publicKey) markNotificationRead(publicKey, id);
  };

  const handleMarkAllRead = () => {
    if (publicKey) markAllNotificationsRead(publicKey);
  };

  const handleDelete = (id: string) => {
    if (publicKey) deleteNotification(publicKey, id);
  };

  const handleClearAll = () => {
    if (publicKey) clearNotifications(publicKey);
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <Head>
        <title>Notifications | Finchippay</title>
        <meta
          name="description"
          content="Your Finchippay in-app notification inbox — mark, filter, and manage payment notifications."
        />
      </Head>

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
            Notifications
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {unreadCount > 0
              ? `${unreadCount} unread notification${unreadCount > 1 ? "s" : ""}`
              : "You're all caught up"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {unreadCount > 0 && (
            <button
              onClick={handleMarkAllRead}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-white/5"
              data-testid="page-mark-all-read"
            >
              <CheckIcon className="h-4 w-4" /> Mark all read
            </button>
          )}
          {notifications.length > 0 && (
            <button
              onClick={handleClearAll}
              className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 px-3 py-1.5 text-sm font-medium text-rose-600 transition-colors hover:bg-rose-50 dark:border-rose-900/40 dark:text-rose-400 dark:hover:bg-rose-900/20"
              data-testid="page-clear-all"
            >
              <TrashIcon className="h-4 w-4" /> Clear all
            </button>
          )}
        </div>
      </div>

      {/* Filter tabs */}
      <div className="mb-5 flex flex-wrap gap-2">
        {EVENT_FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={clsx(
              "rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors",
              filter === f.value
                ? "bg-stellar-500 text-white"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700",
            )}
            aria-pressed={filter === f.value}
            data-testid={`filter-${f.value}`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Notification list */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-slate-200 bg-white py-16 text-center dark:border-slate-700 dark:bg-cosmos-800">
          <span className="mb-3 text-4xl">🔕</span>
          <p className="text-slate-600 dark:text-slate-400">No notifications here yet.</p>
          <p className="mt-1 text-sm text-slate-400 dark:text-slate-500">
            Payment and contract events will appear in this inbox.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((n) => {
            const target = n.deepLink ?? deepLinkForEvent(n.eventType);
            const content = (
              <div className="flex w-full items-start gap-3 text-left">
                <span
                  className={clsx(
                    "mt-1.5 h-2.5 w-2.5 flex-shrink-0 rounded-full",
                    n.read ? "bg-slate-300 dark:bg-slate-600" : "bg-stellar-400",
                  )}
                  aria-hidden="true"
                />
                <div className="min-w-0 flex-1">
                  <p
                    className={clsx(
                      "text-sm",
                      n.read
                        ? "text-slate-500 dark:text-slate-400"
                        : "font-medium text-slate-900 dark:text-white",
                    )}
                  >
                    {n.message}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">
                    {n.eventType.replace(/_/g, " ")} · {formatRelativeTime(n.createdAt)} ago
                  </p>
                </div>
              </div>
            );

            return (
              <div
                key={n.id}
                className={clsx(
                  "flex items-center gap-2 rounded-xl border bg-white p-3 dark:bg-cosmos-800",
                  n.read
                    ? "border-slate-200 dark:border-slate-700"
                    : "border-stellar-500/20",
                )}
                data-testid={`notification-row-${n.id}`}
              >
                {target ? (
                  <Link
                    href={target}
                    onClick={() => handleMarkRead(n.id)}
                    className="flex min-w-0 flex-1 items-start"
                  >
                    {content}
                  </Link>
                ) : (
                  <button
                    onClick={() => handleMarkRead(n.id)}
                    className="flex min-w-0 flex-1 items-start"
                  >
                    {content}
                  </button>
                )}
                <button
                  onClick={() => handleDelete(n.id)}
                  aria-label={`Delete notification: ${n.message}`}
                  className="flex-shrink-0 rounded-lg p-2 text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-900/20 dark:hover:text-rose-400"
                  data-testid={`delete-${n.id}`}
                >
                  <TrashIcon className="h-4 w-4" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

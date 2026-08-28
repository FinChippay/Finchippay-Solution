/**

 * components/NotificationHistory.tsx
 * Reverse-chronological notification history viewer.
 *
 * Displays past notifications with read/unread status, mark-as-read on click,
 * pagination, and a "Clear All" button.
 */

import { useState, useEffect, useCallback } from "react";
import { apiFetch } from "@/lib/api";
import { logger } from "@/lib/logger";

interface HistoryItem {
  id: number;
  eventType: string;
  message: string;
  channel: string;
  read: boolean;
  createdAt: string;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

interface NotificationHistoryProps {
  publicKey: string | null;
}

const CHANNEL_ICONS: Record<string, string> = {
  push: "🔔",
  email: "📧",
  in_app: "💬",
};

const EVENT_ICONS: Record<string, string> = {
  incoming_payment: "💰",
  outgoing_payment: "💸",
  escrow_release: "🔓",
  stream_claim: "🌊",
  multi_sig_approval: "✍️",
  price_alert: "📈",
  scheduled_payment: "📅",
  contract_event: "📄",
};

function formatTimestamp(ts: string): string {
  const d = new Date(ts);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHrs = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHrs < 24) return `${diffHrs}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString();
}

export default function NotificationHistory({ publicKey }: NotificationHistoryProps) {
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const apiBase = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") || "";

  const fetchHistory = useCallback(
    async (page = 1) => {
      if (!publicKey) {
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const res = await apiFetch(
          `${apiBase}/api/notifications/${encodeURIComponent(publicKey)}/history?page=${page}&limit=20`,
        );
        if (!res.ok) throw new Error("Failed to load notification history");
        const data = await res.json();
        setHistory(data.history || []);
        setPagination(data.pagination);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load history");
      } finally {
        setLoading(false);
      }
    },
    [publicKey, apiBase],
  );

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  const handleMarkAsRead = async (item: HistoryItem) => {
    if (item.read || !publicKey) return;
    try {
      await apiFetch(
        `${apiBase}/api/notifications/${encodeURIComponent(publicKey)}/history/${item.id}/read`,
        { method: "PUT" },
      );
      setHistory((prev) =>
        prev.map((h) => (h.id === item.id ? { ...h, read: true } : h)),
      );
    } catch (err) {
      logger.error("Failed to mark as read:", {}, err instanceof Error ? err : undefined);
    }
  };

  const handleClearAll = async () => {
    if (!publicKey) return;
    try {
      await apiFetch(
        `${apiBase}/api/notifications/${encodeURIComponent(publicKey)}/history`,
        { method: "DELETE" },
      );
      setHistory([]);
      setPagination(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to clear history");
    }
  };

  if (!publicKey) {
    return (
      <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-cosmos-800 p-6 text-center">
        <p className="text-slate-500 dark:text-slate-400">
          Connect your wallet to view notification history.
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-cosmos-800 p-6">
        <div className="animate-pulse space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-16 bg-slate-200 dark:bg-slate-700 rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
            Notification History
          </h3>
          {pagination && (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {pagination.total} total notifications
            </p>
          )}
        </div>
        {history.length > 0 && (
          <button
            onClick={handleClearAll}
            className="px-3 py-1.5 rounded-lg bg-red-500 hover:bg-red-600 text-white text-xs font-medium transition"
          >
            Clear All
          </button>
        )}
      </div>

      {error && (
        <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-lg text-rose-400 text-sm">
          {error}
        </div>
      )}

      {/* History List */}
      {history.length === 0 ? (
        <div className="py-12 text-center">
          <span className="text-4xl mb-3 block">🔕</span>
          <p className="text-slate-500 dark:text-slate-400 text-sm">
            No notifications yet.
          </p>
          <p className="text-slate-400 dark:text-slate-500 text-xs mt-1">
            Notifications will appear here when events occur.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {history.map((item) => (
            <button
              key={item.id}
              onClick={() => handleMarkAsRead(item)}
              className={`w-full text-left flex items-start gap-3 p-3 rounded-lg border transition-colors ${
                item.read
                  ? "border-slate-100 dark:border-slate-800 bg-white dark:bg-cosmos-800"
                  : "border-stellar-500/20 bg-stellar-500/5 dark:bg-stellar-500/10"
              } hover:bg-slate-50 dark:hover:bg-cosmos-900/50`}
            >
              <span className="text-lg flex-shrink-0 mt-0.5">
                {EVENT_ICONS[item.eventType] || "📋"}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase">
                    {item.channel}
                  </span>
                  {!item.read && (
                    <span className="w-2 h-2 rounded-full bg-stellar-400 flex-shrink-0" />
                  )}
                </div>
                <p
                  className={`text-sm truncate ${
                    item.read
                      ? "text-slate-500 dark:text-slate-400"
                      : "text-slate-800 dark:text-slate-200 font-medium"
                  }`}
                >
                  {item.message}
                </p>
                <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
                  {formatTimestamp(item.createdAt)}
                </p>
              </div>
              <span className="text-xs text-slate-400 dark:text-slate-500 flex-shrink-0">
                {CHANNEL_ICONS[item.channel] || "📨"}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Pagination */}
      {pagination && pagination.totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-2">
          {Array.from({ length: pagination.totalPages }, (_, i) => i + 1).map(
            (page) => (
              <button
                key={page}
                onClick={() => fetchHistory(page)}
                className={`px-3 py-1 rounded text-xs font-medium transition ${
                  page === pagination.page
                    ? "bg-stellar-500 text-white"
                    : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700"
                }`}
              >
                {page}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}

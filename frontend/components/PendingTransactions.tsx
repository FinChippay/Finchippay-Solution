/**
 * components/PendingTransactions.tsx
 * Dashboard section listing offline-queued transactions with their status
 * (queued / submitting / submitted / failed), a way to retry a failed sync,
 * removal, and a toast when a new transaction is queued for later.
 *
 * WCAG: list and status changes are announced via an aria-live region.
 */
"use client";

import { useEffect, useRef } from "react";
import { useOfflineQueue } from "@/lib/useOfflineQueue";
import { useToastContext } from "@/lib/ToastContext";
import type { QueuedTransaction } from "@/lib/offlineQueue";

const STATUS_META: Record<
  QueuedTransaction["status"],
  { label: string; badge: string }
> = {
  queued: { label: "Queued", badge: "bg-amber-500/15 text-amber-300 border-amber-500/30" },
  submitting: { label: "Submitting", badge: "bg-blue-500/15 text-blue-300 border-blue-500/30" },
  submitted: { label: "Submitted", badge: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" },
  failed: { label: "Failed", badge: "bg-red-500/15 text-red-300 border-red-500/30" },
};

export default function PendingTransactions() {
  const { transactions, pendingCount, syncStatus, processQueue, removeTransaction } =
    useOfflineQueue();
  const { addToast } = useToastContext();

  const pending = transactions.filter((t) => t.status !== "submitted");
  const failedCount = pending.filter((t) => t.status === "failed").length;

  // Fire a toast the moment a brand-new queued transaction appears.
  const seenRef = useRef<Set<string>>(new Set());
  const announcedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const tx of transactions) {
      if (!seenRef.current.has(tx.id)) {
        seenRef.current.add(tx.id);
        if (tx.status === "queued" && !announcedRef.current.has(tx.id)) {
          announcedRef.current.add(tx.id);
          addToast("Transaction queued — will be sent when you're back online.", "info");
        }
      }
    }
  }, [transactions, addToast]);

  if (pending.length === 0) return null;

  const formatTime = (ts: number) =>
    new Date(ts).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

  return (
    <section
      aria-labelledby="pending-transactions-heading"
      className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800/60"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id="pending-transactions-heading" className="text-base font-semibold text-slate-800 dark:text-slate-100">
          Pending transactions
        </h2>
        <div className="flex items-center gap-2">
          {failedCount > 0 && (
            <span className="rounded-full border border-red-500/30 bg-red-500/15 px-2 py-0.5 text-xs font-medium text-red-300">
              {failedCount} failed
            </span>
          )}
          <button
            type="button"
            onClick={() => void processQueue()}
            disabled={syncStatus === "syncing"}
            className="rounded-lg border border-slate-300 px-3 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-100 disabled:opacity-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
          >
            {syncStatus === "syncing" ? "Syncing…" : "Sync now"}
          </button>
        </div>
      </div>

      {/* Live region announcing changes to the pending list. */}
      <div aria-live="polite" className="sr-only">
        {pending.length} pending transaction{pending.length > 1 ? "s" : ""}
        {failedCount > 0 ? `, ${failedCount} failed` : ""}.
      </div>

      <ul className="divide-y divide-slate-100 dark:divide-slate-700">
        {pending.map((tx) => {
          const meta = STATUS_META[tx.status] ?? STATUS_META.queued;
          return (
            <li key={tx.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-800 dark:text-slate-100">
                  {tx.amount} {tx.asset}
                  <span className="ml-2 truncate align-middle text-xs font-normal text-slate-400">
                    → {shorten(tx.destination)}
                  </span>
                  <span className="ml-2 text-xs font-normal text-slate-400">
                    {formatTime(tx.createdAt)}
                  </span>
                </p>
                {tx.status === "failed" && tx.error && (
                  <p className="mt-0.5 truncate text-xs text-red-400">{tx.error}</p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span
                  className={`rounded-full border px-2 py-0.5 text-xs font-medium ${meta.badge}`}
                >
                  {meta.label}
                </span>
                {tx.status === "failed" && (
                  <button
                    type="button"
                    onClick={() => void processQueue()}
                    className="rounded border border-slate-300 px-2 py-0.5 text-xs text-slate-600 transition hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
                  >
                    Retry
                  </button>
                )}
                {tx.status !== "submitting" && (
                  <button
                    type="button"
                    onClick={() => void removeTransaction(tx.id)}
                    aria-label={`Remove queued payment to ${shorten(tx.destination)}`}
                    className="rounded border border-slate-300 px-2 py-0.5 text-xs text-slate-400 transition hover:border-red-400 hover:text-red-400 dark:border-slate-600"
                  >
                    Remove
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function shorten(addr: string): string {
  if (!addr || addr.length <= 12) return addr ?? "";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

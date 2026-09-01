"use client";

/**
 * components/OfflineTransactionComposer.tsx
 *
 * A send form that works without connectivity (Issue #483). It validates the
 * destination locally (reusing `isValidStellarAddress`), persists the composed
 * payment to the IndexedDB offline queue, and registers a Background Sync so the
 * service worker can submit it once connectivity returns.
 *
 * Signing is intentionally deferred to processing time — offline transaction
 * signing requires Freighter and is out of scope for this issue. When the device
 * reconnects, the queued intent is built, signed, and submitted automatically.
 */

import clsx from "clsx";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import { useToastContext } from "@/lib/ToastContext";
import {
  enqueue,
  getAll,
  processQueue,
  remove,
  PAYMENT_ENTRY_TYPE,
  type PaymentPayload,
  type QueueEntry,
  type QueueStatus,
} from "@/lib/offlineQueue";
import { isValidStellarAddress } from "@/lib/stellar";
import { useWalletOptional } from "@/lib/useWallet";

interface OfflineTransactionComposerProps {
  className?: string;
}

/** A single queued item, flattened for display. */
interface ComposedItem {
  id: string;
  destination: string;
  amount: string;
  asset: string;
  status: QueueStatus;
  retryCount: number;
  lastError?: string;
}

const STATUS_LABELS: Record<QueueStatus, string> = {
  pending: "Queued",
  processing: "Submitting",
  failed: "Failed",
};

function toComposedItem(entry: QueueEntry): ComposedItem {
  const payload = (entry.payload ?? {}) as Partial<PaymentPayload>;
  return {
    id: entry.id,
    destination: typeof payload.destination === "string" ? payload.destination : "",
    amount: typeof payload.amount === "string" ? payload.amount : "",
    asset: payload.asset === "USDC" ? "USDC" : "XLM",
    status: entry.status,
    retryCount: entry.retryCount,
    lastError: entry.lastError,
  };
}

export default function OfflineTransactionComposer({ className }: OfflineTransactionComposerProps) {
  const wallet = useWalletOptional();
  const publicKey = wallet?.publicKey ?? null;
  const { isOnline, pendingCount, refreshQueue } = useNetworkStatus();
  const { addToast } = useToastContext();

  const [destination, setDestination] = useState("");
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [destinationError, setDestinationError] = useState<string | null>(null);
  const [amountError, setAmountError] = useState<string | null>(null);
  const [items, setItems] = useState<ComposedItem[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const entries = await getAll();
      setItems(entries.filter((entry) => entry.type === PAYMENT_ENTRY_TYPE).map(toComposedItem));
    } catch {
      // IndexedDB unavailable (e.g. Safari private mode) — keep prior list.
    }
  }, []);

  // Re-read the queue on mount, when the pending count changes (e.g. after an
  // auto-submit), and when the service worker reports it has drained the queue.
  useEffect(() => {
    void refresh();
    const intervalId = window.setInterval(() => void refresh(), 10_000);

    const onSwMessage = (event: MessageEvent) => {
      if (event.data?.type === "QUEUE_PROCESSED" || event.data?.type === "QUEUE_NEEDS_SIGNING") {
        void refresh();
        void refreshQueue();
      }
    };
    navigator.serviceWorker?.addEventListener("message", onSwMessage);

    return () => {
      window.clearInterval(intervalId);
      navigator.serviceWorker?.removeEventListener("message", onSwMessage);
    };
  }, [refresh, refreshQueue]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const trimmedDestination = destination.trim();
    const amountNum = Number(amount);

    if (!publicKey) {
      addToast("Connect your wallet before composing a transaction.", "error");
      return;
    }

    let hasError = false;
    if (!trimmedDestination) {
      setDestinationError("Enter a recipient address.");
      hasError = true;
    } else if (!isValidStellarAddress(trimmedDestination)) {
      setDestinationError("Enter a valid Stellar address (starts with G).");
      hasError = true;
    } else {
      setDestinationError(null);
    }

    if (!amount || !Number.isFinite(amountNum) || amountNum <= 0) {
      setAmountError("Enter an amount greater than 0.");
      hasError = true;
    } else {
      setAmountError(null);
    }

    if (hasError) return;

    setIsSubmitting(true);
    try {
      await enqueue<PaymentPayload>(PAYMENT_ENTRY_TYPE, {
        from: publicKey,
        destination: trimmedDestination,
        amount: amountNum.toFixed(7),
        asset: "XLM",
        memo: memo.trim() || undefined,
      });

      setDestination("");
      setAmount("");
      setMemo("");
      addToast("Transaction saved to the offline queue.", "success");
      await refresh();
      await refreshQueue();
    } catch {
      addToast("Could not save the transaction to the offline queue.", "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRetry = async () => {
    if (isRetrying) return;
    setIsRetrying(true);
    try {
      await processQueue();
      await refresh();
      await refreshQueue();
    } catch {
      addToast("Could not process the offline queue.", "error");
    } finally {
      setIsRetrying(false);
    }
  };

  const handleRemove = async (id: string) => {
    try {
      await remove(id);
      await refresh();
      await refreshQueue();
    } catch {
      addToast("Could not remove the queued transaction.", "error");
    }
  };

  const pendingItems = items.filter((item) => item.status !== undefined);

  return (
    <section
      className={clsx("card space-y-6", className)}
      aria-labelledby="offline-composer-heading"
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2
            id="offline-composer-heading"
            className="font-display text-lg font-semibold text-slate-900 dark:text-white"
          >
            Compose transaction
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Works offline — it will be sent automatically when you reconnect.
          </p>
        </div>
        <span
          className={clsx(
            "shrink-0 rounded-full border px-2.5 py-1 text-xs font-semibold",
            isOnline
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
              : "border-amber-500/30 bg-amber-500/10 text-amber-300",
          )}
          data-testid="offline-composer-status"
        >
          {isOnline ? "Online" : "Offline"}
        </span>
      </div>

      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        <div>
          <label htmlFor="offline-destination" className="label mb-2">
            Recipient address
          </label>
          <input
            id="offline-destination"
            type="text"
            inputMode="text"
            autoComplete="off"
            spellCheck={false}
            placeholder="G…"
            value={destination}
            onChange={(event) => setDestination(event.target.value)}
            aria-invalid={destinationError ? true : undefined}
            aria-describedby={destinationError ? "offline-destination-error" : undefined}
            className={clsx(
              "input-field py-2.5 font-mono",
              destinationError && "border-red-500/60",
            )}
            data-testid="offline-composer-destination"
          />
          {destinationError && (
            <p id="offline-destination-error" className="text-xs text-red-400 mt-1.5" role="alert">
              {destinationError}
            </p>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="offline-amount" className="label mb-2">
              Amount (XLM)
            </label>
            <input
              id="offline-amount"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.0000001"
              placeholder="0.00"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              aria-invalid={amountError ? true : undefined}
              aria-describedby={amountError ? "offline-amount-error" : undefined}
              className={clsx("input-field py-2.5", amountError && "border-red-500/60")}
              data-testid="offline-composer-amount"
            />
            {amountError && (
              <p id="offline-amount-error" className="text-xs text-red-400 mt-1.5" role="alert">
                {amountError}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="offline-memo" className="label mb-2">
              Memo (optional)
            </label>
            <input
              id="offline-memo"
              type="text"
              maxLength={28}
              placeholder="e.g. Rent"
              value={memo}
              onChange={(event) => setMemo(event.target.value)}
              className="input-field py-2.5"
              data-testid="offline-composer-memo"
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={isSubmitting}
          className="btn-primary w-full py-2.5 disabled:cursor-not-allowed disabled:opacity-60"
          data-testid="offline-composer-submit"
        >
          {isSubmitting ? "Saving…" : "Queue for later"}
        </button>
      </form>

      <div className="border-t border-slate-200 dark:border-white/5 pt-4" aria-live="polite">
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-medium text-slate-700 dark:text-slate-200">Offline queue</p>
          <span
            className="rounded-full bg-amber-500/10 border border-amber-500/30 px-2 py-0.5 text-[11px] font-semibold text-amber-300"
            data-testid="offline-composer-pending-count"
          >
            {pendingCount} pending
          </span>
        </div>

        {pendingItems.length === 0 ? (
          <p className="text-xs text-slate-500 dark:text-slate-400">No queued transactions.</p>
        ) : (
          <ul className="space-y-2">
            {pendingItems.map((item) => (
              <li
                key={item.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 dark:border-white/5 bg-slate-50 dark:bg-white/[0.03] px-3 py-2.5"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-slate-800 dark:text-slate-100 truncate">
                      {item.amount} {item.asset}
                    </span>
                    <span
                      className={clsx(
                        "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold",
                        item.status === "pending" && "bg-amber-500/10 text-amber-300",
                        item.status === "processing" && "bg-blue-500/10 text-blue-300",
                        item.status === "failed" && "bg-red-500/10 text-red-300",
                      )}
                    >
                      {STATUS_LABELS[item.status]}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 truncate font-mono">
                    {item.destination}
                  </p>
                  {item.status === "failed" && (
                    <p className="text-[11px] text-red-400 mt-0.5 truncate">
                      {item.lastError ?? `Retry ${item.retryCount} of 3`}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => void handleRemove(item.id)}
                  className="shrink-0 text-xs text-slate-500 hover:text-red-400 transition-colors"
                  aria-label={`Remove queued transaction to ${item.destination}`}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}

        {pendingItems.length > 0 && (
          <button
            type="button"
            onClick={() => void handleRetry()}
            disabled={isRetrying}
            className="btn-secondary mt-3 w-full py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60"
            data-testid="offline-composer-retry"
          >
            {isRetrying ? "Submitting…" : "Retry now"}
          </button>
        )}
      </div>
    </section>
  );
}

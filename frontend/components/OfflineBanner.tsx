"use client";

/**
 * components/OfflineBanner.tsx
 *
 * Sticky top banner shown when the user is offline.  Displays:
 *  - Cache age (how stale the local data is)
 *  - Number of transactions waiting in the offline queue
 *  - "Retry" button to manually trigger queue submission
 *  - Brief "Back online!" confirmation when connectivity returns
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import { getCachedData, getMinutesAgo } from "@/lib/cacheData";
import {
  getQueueCount,
  processQueue,
  registerBackgroundSync,
} from "@/lib/offlineQueue";

export default function OfflineBanner() {
  const { isOnline } = useNetworkStatus();
  const isOffline = !isOnline;
  const [cacheAge, setCacheAge] = useState<number | null>(null);
  const [queueCount, setQueueCount] = useState(0);
  const [showOnlineTransition, setShowOnlineTransition] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const prevOnline = useRef(isOnline);

  /** Refresh the pending-transaction count from IndexedDB. */
  const refreshQueueCount = useCallback(async () => {
    try {
      setQueueCount(await getQueueCount());
    } catch {
      // IndexedDB may be unavailable in some browsers.
    }
  }, []);

  /** Refresh the cached-data age from IndexedDB. */
  const refreshCacheAge = useCallback(async () => {
    try {
      const cached = await getCachedData("dashboard-data");
      if (cached) setCacheAge(getMinutesAgo(cached.cachedAt));
    } catch {
      // Cache unavailable — skip.
    }
  }, []);

  // Initial data load on mount.
  useEffect(() => {
    void refreshCacheAge();
    void refreshQueueCount();
  }, [refreshCacheAge, refreshQueueCount]);

  // React to online/offline transitions reported by useNetworkStatus().
  useEffect(() => {
    if (prevOnline.current === isOnline) return;
    prevOnline.current = isOnline;

    if (isOnline) {
      setShowOnlineTransition(true);
      void (async () => {
        // Trigger queue processing as soon as the tab comes online.
        try {
          await registerBackgroundSync();
        } catch {
          // Fallback: process directly in the main thread.
          void processQueue();
        }
        await refreshQueueCount();
        setTimeout(() => setShowOnlineTransition(false), 2500);
      })();
    } else {
      setShowOnlineTransition(false);
      void refreshCacheAge();
      void refreshQueueCount();
    }
  }, [isOnline, refreshCacheAge, refreshQueueCount]);

  // Listen for the SW's QUEUE_PROCESSED message to refresh badge count.
  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleSwMessage = (event: MessageEvent) => {
      if (event.data?.type === "QUEUE_PROCESSED") {
        void refreshQueueCount();
      }
    };
    navigator.serviceWorker?.addEventListener("message", handleSwMessage);

    return () => {
      navigator.serviceWorker?.removeEventListener("message", handleSwMessage);
    };
  }, [refreshQueueCount]);

  /** Manually trigger queue submission (works even without Background Sync). */
  const handleRetry = async () => {
    if (isRetrying) return;
    setIsRetrying(true);
    try {
      // Prefer posting to the SW so it can run even if the tab closes mid-way.
      const reg = await navigator.serviceWorker?.ready;
      if (reg?.active) {
        reg.active.postMessage({ type: "RETRY_QUEUE" });
        // Give the SW a moment then refresh count.
        setTimeout(() => void refreshQueueCount(), 2000);
      } else {
        await processQueue();
        await refreshQueueCount();
      }
    } catch {
      // Fall back to in-page processing.
      await processQueue();
      await refreshQueueCount();
    } finally {
      setIsRetrying(false);
    }
  };

  // Nothing to render when we're online and no transition is playing.
  if (!isOffline && !showOnlineTransition) return null;

  // ── Online transition ──────────────────────────────────────────────────────
  if (showOnlineTransition) {
    return (
      <div
        className="fixed top-0 left-0 right-0 z-50 animate-slide-down"
        role="status"
        aria-live="polite"
      >
        <div className="mx-auto max-w-3xl px-4 py-2">
          <div className="rounded-b-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-center backdrop-blur-md shadow-lg">
            <p className="text-sm font-medium text-emerald-200">
              ✓ You are back online!
            </p>
            {queueCount > 0 && (
              <p className="text-xs text-emerald-200/70 mt-0.5">
                Submitting {queueCount} queued transaction
                {queueCount > 1 ? "s" : ""}…
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Offline banner ─────────────────────────────────────────────────────────
  return (
    <div
      className="fixed top-0 left-0 right-0 z-50 animate-slide-down"
      role="alert"
      aria-live="assertive"
    >
      <div className="mx-auto max-w-3xl px-4 py-2">
        <div className="rounded-b-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 backdrop-blur-md shadow-lg">
          <div className="flex items-center justify-between gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-amber-200">
                You are offline
              </p>
              <p className="text-xs text-amber-200/70 mt-0.5 truncate">
                {cacheAge !== null
                  ? `Showing cached data from ${cacheAge} min ago`
                  : "Some features may be limited"}
                {queueCount > 0 &&
                  ` · ${queueCount} transaction${queueCount > 1 ? "s" : ""} queued`}
              </p>
            </div>

            {queueCount > 0 && (
              <button
                onClick={() => void handleRetry()}
                disabled={isRetrying}
                className="shrink-0 rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-1.5 text-xs font-semibold text-amber-200 transition-all hover:bg-amber-400/20 disabled:cursor-not-allowed disabled:opacity-50"
                aria-label={
                  isRetrying
                    ? "Retrying queued transactions…"
                    : `Retry ${queueCount} queued transaction${queueCount > 1 ? "s" : ""}`
                }
                data-testid="offline-banner-retry"
              >
                {isRetrying ? (
                  <span className="flex items-center gap-1.5">
                    <svg
                      className="h-3 w-3 animate-spin"
                      viewBox="0 0 24 24"
                      fill="none"
                      aria-hidden="true"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z"
                      />
                    </svg>
                    Retrying…
                  </span>
                ) : (
                  "Retry"
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

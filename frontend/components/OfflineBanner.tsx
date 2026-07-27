/**
 * components/OfflineBanner.tsx
 *
 * Enhanced offline banner that shows:
 *   - Current connectivity status
 *   - Cached data age ("Showing cached data from 5 minutes ago")
 *   - Number of queued actions pending sync
 *   - Animated "Back online" confirmation when connectivity returns
 *
 * Uses useNetworkStatus for live connectivity tracking and the offlineQueue
 * module to poll the queue length.
 */

import { useState, useEffect, useRef } from "react";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import { getQueueLength } from "@/lib/offlineQueue";
import { buildAgeLabel } from "@/lib/cacheData";

// How often (ms) to refresh the age label and queue count while offline
const POLL_INTERVAL_MS = 30_000;

export default function OfflineBanner() {
  const { isOnline, wasOffline, lastOnlineAt } = useNetworkStatus();
  const [queueLength, setQueueLength] = useState(0);
  const [ageLabel, setAgeLabel] = useState<string | null>(null);
  // Controls the transient "Back online" confirmation strip
  const [showBackOnline, setShowBackOnline] = useState(false);
  const backOnlineTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Compute age label from lastOnlineAt ─────────────────────────────────

  const refreshAgeLabel = () => {
    if (lastOnlineAt) {
      setAgeLabel(buildAgeLabel(lastOnlineAt));
    }
  };

  // ── Poll queue length ───────────────────────────────────────────────────

  const refreshQueueLength = async () => {
    const len = await getQueueLength();
    setQueueLength(len);
  };

  // ── Effect: refresh data while offline ─────────────────────────────────

  useEffect(() => {
    if (isOnline) {
      // Clear polling when back online
      return;
    }

    refreshAgeLabel();
    refreshQueueLength();

    const interval = setInterval(() => {
      refreshAgeLabel();
      refreshQueueLength();
    }, POLL_INTERVAL_MS);

    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnline, lastOnlineAt]);

  // ── Effect: also refresh queue length when online (after drain) ─────────

  useEffect(() => {
    if (isOnline) {
      refreshQueueLength();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnline]);

  // ── Effect: show "Back online" banner briefly after reconnection ─────────

  useEffect(() => {
    if (!isOnline || !wasOffline) return;

    // Reconnected after being offline — show the confirmation strip
    setShowBackOnline(true);

    if (backOnlineTimer.current) {
      clearTimeout(backOnlineTimer.current);
    }
    backOnlineTimer.current = setTimeout(() => {
      setShowBackOnline(false);
    }, 4000);

    return () => {
      if (backOnlineTimer.current) {
        clearTimeout(backOnlineTimer.current);
      }
    };
  }, [isOnline, wasOffline]);

  // ── Render: "Back online" strip ─────────────────────────────────────────

  if (isOnline && showBackOnline) {
    return (
      <div
        className="fixed top-0 left-0 right-0 z-50 animate-slide-down"
        role="status"
        aria-live="polite"
        aria-label="Back online"
      >
        <div className="mx-auto max-w-3xl px-4 py-1.5">
          <div className="rounded-b-xl border border-emerald-500/30 bg-emerald-500/15 px-4 py-2 backdrop-blur-md text-center shadow-lg">
            <p className="text-sm font-medium text-emerald-300 flex items-center justify-center gap-2">
              {/* Wifi icon */}
              <svg
                className="h-4 w-4 flex-shrink-0"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M8.288 15.038a5.25 5.25 0 017.424 0M5.106 11.856c3.807-3.808 9.98-3.808 13.788 0M1.924 8.674c5.565-5.565 14.587-5.565 20.152 0M12.53 18.22l-.53.53-.53-.53a.75.75 0 011.06 0z"
                />
              </svg>
              Back online
              {queueLength > 0 && (
                <span className="text-xs text-emerald-300/80">
                  — syncing {queueLength} queued action{queueLength === 1 ? "" : "s"}
                </span>
              )}
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ── Render: offline banner ───────────────────────────────────────────────

  if (!isOnline) {
    return (
      <div
        className="fixed top-0 left-0 right-0 z-50 animate-slide-down"
        role="alert"
        aria-live="assertive"
        aria-label="You are offline"
      >
        <div className="mx-auto max-w-3xl px-4 py-2">
          <div className="rounded-b-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 backdrop-blur-md text-center shadow-lg">
            {/* Status row */}
            <p className="text-sm font-medium text-amber-200 flex items-center justify-center gap-2">
              {/* No-wifi icon */}
              <svg
                className="h-4 w-4 flex-shrink-0"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M3 3l18 18M8.288 15.038a5.25 5.25 0 017.424 0M5.106 11.856c1.26-1.26 2.775-2.174 4.389-2.745M2.5 8.5c1.07-1.07 2.29-1.995 3.624-2.76M19.894 11.856a9.675 9.675 0 00-1.12-.957M16.5 8.5a9.674 9.674 0 00-9 0M12.53 18.22l-.53.53-.53-.53a.75.75 0 011.06 0z"
                />
              </svg>
              You&apos;re offline
            </p>

            {/* Cached data age */}
            {ageLabel ? (
              <p className="text-xs text-amber-200/70 mt-0.5">
                Showing cached data from {ageLabel}
              </p>
            ) : (
              <p className="text-xs text-amber-200/70 mt-0.5">
                Showing cached data — some features may be limited
              </p>
            )}

            {/* Queued actions */}
            {queueLength > 0 && (
              <p className="text-xs text-amber-300/80 mt-0.5 font-medium">
                {queueLength} action{queueLength === 1 ? "" : "s"} queued — will execute when back online
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  return null;
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { useToastContext } from "@/lib/ToastContext";
import { getQueueCount, processQueue, registerBackgroundSync } from "@/lib/offlineQueue";

/**
 * hooks/useNetworkStatus.ts
 *
 * Connectivity + offline-queue state for the app (Issue #483).
 *
 * Consumers get:
 *  - `isOnline` / `wasOffline` / `lastOnlineAt` (as before)
 *  - `pendingCount` — number of transactions awaiting submission
 *  - `refreshQueue` — imperative re-read of the pending count
 *
 * On reconnection the hook registers a Background Sync and then drains the
 * queue in the main thread, surfacing a toast when any queued transactions
 * were auto-submitted. Draining here (rather than only in the service worker)
 * matters because unsigned payment intents must be signed by Freighter, which
 * only runs in a window context.
 */
export interface NetworkStatus {
  isOnline: boolean;
  wasOffline: boolean;
  lastOnlineAt: number | null;
  pendingCount: number;
  refreshQueue: () => Promise<void>;
}

export function useNetworkStatus(): NetworkStatus {
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== "undefined" ? navigator.onLine : true,
  );
  const [wasOffline, setWasOffline] = useState(false);
  const [lastOnlineAt, setLastOnlineAt] = useState<number | null>(
    typeof window !== "undefined" ? Date.now() : null,
  );
  const [pendingCount, setPendingCount] = useState(0);
  const { addToast } = useToastContext();

  const refreshQueue = useCallback(async () => {
    try {
      setPendingCount(await getQueueCount());
    } catch {
      // IndexedDB may be unavailable (private browsing); keep the last value.
    }
  }, []);

  useEffect(() => {
    void refreshQueue();

    const goOnline = async () => {
      setIsOnline(true);
      setWasOffline(true);
      setLastOnlineAt(Date.now());

      // Register Background Sync (fire-and-forget so a missing worker never
      // blocks main-thread processing below).
      void registerBackgroundSync();

      try {
        const before = await getQueueCount();
        await processQueue();
        const after = await getQueueCount();
        setPendingCount(after);

        const submitted = Math.max(0, before - after);
        if (submitted > 0) {
          addToast(
            `Submitted ${submitted} queued transaction${submitted > 1 ? "s" : ""} automatically.`,
            "success",
          );
        }
      } catch {
        // Processing failed; the entries stay queued and will retry on the
        // next connectivity event.
      }
    };

    const goOffline = () => {
      setIsOnline(false);
    };

    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, [addToast, refreshQueue]);

  return { isOnline, wasOffline, lastOnlineAt, pendingCount, refreshQueue };
}

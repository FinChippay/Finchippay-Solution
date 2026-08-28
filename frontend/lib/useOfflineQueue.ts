/**
 * lib/useOfflineQueue.ts
 * React hook exposing the offline transaction queue with real-time updates and
 * a derived sync status. Consumed by OfflineBanner and the dashboard
 * "Pending transactions" section so queue count, pending items and sync status
 * stay in sync with IndexedDB changes (from any tab / component) and network
 * transitions.
 *
 * Built on the shared lib/offlineQueue API (getQueuedTransactions /
 * getQueueCount / processQueue / removeTransaction / subscribeToQueue).
 */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  getQueuedTransactions,
  getQueueCount,
  processQueue,
  removeTransaction,
  subscribeToQueue,
  onQueueChanged,
  type QueuedTransaction,
} from "@/lib/offlineQueue";

export type SyncStatus =
  | "online" // connected, nothing pending
  | "offline" // disconnected (red)
  | "queued" // connected but actions pending sync (yellow)
  | "syncing" // currently replaying queued actions (blue)
  | "synced"; // just finished syncing (green, transient)

export interface UseOfflineQueueResult {
  transactions: QueuedTransaction[];
  pendingCount: number;
  queueCount: number;
  syncStatus: SyncStatus;
  isOffline: boolean;
  processQueue: () => Promise<void>;
  removeTransaction: (id: string) => Promise<void>;
  refresh: () => Promise<void>;
}

const SYNCED_VISIBLE_MS = 4000;

export function useOfflineQueue(): UseOfflineQueueResult {
  const [transactions, setTransactions] = useState<QueuedTransaction[]>([]);
  const [queueCount, setQueueCount] = useState(0);
  const [isOffline, setIsOffline] = useState<boolean>(
    typeof navigator !== "undefined" ? !navigator.onLine : false
  );
  const [syncing, setSyncing] = useState(false);
  const [syncedAt, setSyncedAt] = useState<number | null>(null);
  const syncedAtRef = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    const [next, count] = await Promise.all([getQueuedTransactions(), getQueueCount()]);
    setTransactions(next);
    setQueueCount(count);
  }, []);

  // Initial load + subscribe to queue mutations (this lib + window event).
  useEffect(() => {
    void refresh();
    const unsub = subscribeToQueue(() => {
      void refresh();
    });
    const offWindow = onQueueChanged(() => {
      void refresh();
    });
    // processQueue dispatches finchippay:queue-results when it completes.
    const onResults = () => {
      syncedAtRef.current = Date.now();
      setSyncedAt(Date.now());
      void refresh();
    };
    window.addEventListener("finchippay:queue-results", onResults);
    return () => {
      unsub();
      offWindow();
      window.removeEventListener("finchippay:queue-results", onResults);
    };
  }, [refresh]);

  // Track connectivity + auto-sync once we come back online.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const goOnline = () => {
      setIsOffline(false);
      // Give the browser a beat to restore connectivity, then flush the queue.
      setTimeout(() => {
        void runProcess();
      }, 1500);
    };
    const goOffline = () => setIsOffline(true);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runProcess = useCallback(async () => {
    setSyncing(true);
    try {
      await processQueue();
    } finally {
      setSyncing(false);
      void refresh();
    }
  }, [refresh]);

  const removeTx = useCallback(async (id: string) => {
    await removeTransaction(id);
    await refresh();
  }, [refresh]);

  const pendingCount = transactions.filter(
    (t) => t.status === "queued" || t.status === "failed"
  ).length;

  let syncStatus: SyncStatus;
  if (syncing) {
    syncStatus = "syncing";
  } else if (isOffline) {
    syncStatus = "offline";
  } else if (pendingCount > 0) {
    syncStatus = "queued";
  } else if (syncedAt !== null && Date.now() - syncedAt < SYNCED_VISIBLE_MS) {
    syncStatus = "synced";
  } else {
    syncStatus = "online";
  }

  return {
    transactions,
    pendingCount,
    queueCount,
    syncStatus,
    isOffline,
    processQueue: runProcess,
    removeTransaction: removeTx,
    refresh,
  };
}

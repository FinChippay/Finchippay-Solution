/**
 * lib/useBalanceStream.ts
 * Real-time XLM balance over Server-Sent Events, with a polling fallback (#157).
 *
 * The dashboard used to poll Horizon on a fixed interval, so a payment could sit
 * invisible for up to 30 seconds. This hook subscribes to
 * `GET /api/accounts/:publicKey/stream`, which pushes a new balance whenever
 * Horizon reports a payment touching the account.
 *
 * Failure handling:
 *   - No `EventSource` support, or no SEP-10 token → poll from the start.
 *   - Transport failure → close the stream, poll every 30s, and retry the
 *     stream with exponential backoff (1s, 2s, 4s, 8s, 16s, capped at 30s).
 *   - Tab hidden → tear everything down; reconnect when it becomes visible.
 *
 * Optimistic updates & reconciliation (#641):
 *   - User actions (send / claim) can apply an optimistic balance delta that is
 *     shown immediately and rolled back on error via `rollbackOptimistic`.
 *   - A `status` field exposes the live / reconnecting / stale / polling state
 *     so the UI can surface connection health instead of a bare boolean.
 *   - `reconcile()` fetches the authoritative balance and drops any stale
 *     optimistic deltas, so the UI never shows a number the server disagrees
 *     with for long.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import { ensureAccessToken } from "@/lib/auth";
import { getXLMBalance } from "@/lib/stellar";

const POLL_INTERVAL_MS = 30_000;
const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;
/** After this long without a confirmed balance, a non-live stream is "stale". */
const STALE_AFTER_MS = 90_000;
const STROOPS_PER_XLM = 10_000_000n;

const API_URL = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000").replace(
  /\/+$/,
  ""
);

export type BalanceStreamStatus = "live" | "reconnecting" | "stale" | "polling";

export interface BalanceStream {
  /** Display balance — optimistic deltas applied on top of the confirmed value. */
  xlmBalance: string;
  /** Authoritative balance last confirmed by the server (SSE or polling). */
  confirmedXlmBalance: string;
  /** True while balance updates are arriving over SSE rather than polling. */
  isLive: boolean;
  /** Connection health, richer than the legacy `isLive` boolean. */
  status: BalanceStreamStatus;
  error: string | null;
  /**
   * Timestamp of the last delivered balance, or null before the first one.
   * Lets callers tell "no value yet" apart from a genuine balance of "0".
   */
  lastUpdatedAt: number | null;
  /** True while at least one optimistic delta is pending. */
  isOptimistic: boolean;
  /** The optimistic display balance, or null when no optimistic delta is pending. */
  optimisticXlmBalance: string | null;
  /**
   * Apply an optimistic delta (e.g. "-5.0000000" after a send). The display
   * balance changes immediately; call `rollbackOptimistic(key)` on error.
   */
  applyOptimisticDelta(deltaXlm: string, key: string): void;
  /** Remove a pending optimistic delta, restoring the confirmed balance. */
  rollbackOptimistic(key: string): void;
  /** Fetch the authoritative balance and clear optimistic deltas. */
  reconcile(): Promise<void>;
}

function backoffDelay(attempt: number) {
  return Math.min(INITIAL_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS);
}

/** Parse an XLM string to stroops (integer) to avoid float drift. */
function toStroops(xlm: string): bigint {
  return BigInt(Math.round(parseFloat(xlm) * Number(STROOPS_PER_XLM)));
}

/** Format stroops back to a 7-decimal XLM string. */
function fromStroops(stroops: bigint): string {
  return (Number(stroops) / Number(STROOPS_PER_XLM)).toFixed(7);
}

export function useBalanceStream(publicKey: string | null): BalanceStream {
  const [confirmedXlmBalance, setConfirmedXlmBalance] = useState("0");
  const [isLive, setIsLive] = useState(false);
  const [status, setStatus] = useState<BalanceStreamStatus>("polling");
  const [error, setError] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  // key -> pending optimistic delta (stroops). Optimistic deltas accumulate on
  // top of the confirmed balance.
  const [optimisticDeltas, setOptimisticDeltas] = useState<Map<string, bigint>>(
    new Map()
  );

  const sourceRef = useRef<EventSource | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const staleTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const attemptRef = useRef(0);
  // Guards against a slow poll resolving after the account changed or the hook
  // unmounted and writing a balance that belongs to a different account.
  const generationRef = useRef(0);
  // The authoritative confirmed balance mirrored into a ref so the optimistic
  // helpers can read the latest value without re-subscribing to state.
  const confirmedRef = useRef("0");
  const lastUpdatedRef = useRef<number | null>(null);
  const isLiveRef = useRef(false);

  const updateConfirmed = useCallback((value: string, ts: number) => {
    confirmedRef.current = value;
    lastUpdatedRef.current = ts;
    setConfirmedXlmBalance(value);
    setLastUpdatedAt(ts);
  }, []);

  // Derived display balance = confirmed + Σ optimistic deltas.
  const optimisticTotal = useCallback((deltas: Map<string, bigint>): bigint => {
    let total = 0n;
    for (const delta of deltas.values()) total += delta;
    return total;
  }, []);

  const xlmBalance = useCallback((): string => {
    const base = confirmedRef.current;
    if (optimisticDeltas.size === 0) return base;
    return fromStroops(toStroops(base) + optimisticTotal(optimisticDeltas));
  }, [optimisticDeltas, optimisticTotal]);

  const optimisticXlmBalance = optimisticDeltas.size > 0 ? xlmBalance() : null;

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current !== null) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const startPolling = useCallback(
    (key: string, generation: number) => {
      // Polling is the active data source; ensure the consumer sees a non-live
      // indicator even when no closeSource() preceded this call (e.g. initial
      // EventSource fallback, ticket fetch failure, or reconnection from a
      // stale closure after a generation change).
      setIsLive(false);
      isLiveRef.current = false;
      if (pollTimerRef.current !== null) return;

      const poll = async () => {
        try {
          const balance = await getXLMBalance(key);
          if (generationRef.current !== generation) return;
          updateConfirmed(balance, Date.now());
          setError(null);
        } catch (err) {
          if (generationRef.current !== generation) return;
          setError(err instanceof Error ? err.message : "Failed to load balance.");
        }
      };

      void poll();
      pollTimerRef.current = setInterval(() => void poll(), POLL_INTERVAL_MS);
    },
    [updateConfirmed]
  );

  // Stale detection: when not live and no confirmed balance for a while, flip
  // to "stale" so the UI can warn that the shown number may be out of date.
  useEffect(() => {
    if (staleTimerRef.current !== null) {
      clearInterval(staleTimerRef.current);
      staleTimerRef.current = null;
    }
    if (!publicKey) return;

    staleTimerRef.current = setInterval(() => {
      if (isLiveRef.current) return;
      const last = lastUpdatedRef.current;
      if (last === null || Date.now() - last < STALE_AFTER_MS) return;
      setStatus((prev) => (prev === "live" ? prev : "stale"));
    }, STALE_AFTER_MS / 4);

    return () => {
      if (staleTimerRef.current !== null) clearInterval(staleTimerRef.current);
      staleTimerRef.current = null;
    };
  }, [publicKey]);

  const applyOptimisticDelta = useCallback((deltaXlm: string, key: string) => {
    setOptimisticDeltas((prev) => {
      const next = new Map(prev);
      const delta = toStroops(deltaXlm);
      next.set(key, (next.get(key) ?? 0n) + delta);
      return next;
    });
  }, []);

  const rollbackOptimistic = useCallback((key: string) => {
    setOptimisticDeltas((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Map(prev);
      next.delete(key);
      return next;
    });
  }, []);

  const reconcile = useCallback(async () => {
    if (!publicKey) return;
    try {
      const balance = await getXLMBalance(publicKey);
      // Drop optimistic deltas — the server is authoritative.
      setOptimisticDeltas(new Map());
      updateConfirmed(balance, Date.now());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reconcile balance.");
    }
  }, [publicKey, updateConfirmed]);

  useEffect(() => {
    const generation = generationRef.current + 1;
    generationRef.current = generation;

    if (!publicKey) {
      confirmedRef.current = "0";
      lastUpdatedRef.current = null;
      setConfirmedXlmBalance("0");
      setStatus("polling");
      setIsLive(false);
      isLiveRef.current = false;
      setError(null);
      setLastUpdatedAt(null);
      setOptimisticDeltas(new Map());
      return;
    }

    const closeSource = () => {
      sourceRef.current?.close();
      sourceRef.current = null;
      setIsLive(false);
      isLiveRef.current = false;
    };

    const clearReconnect = () => {
      if (reconnectTimerRef.current !== null) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };

    const connect = async () => {
      if (generationRef.current !== generation) return;

      if (typeof window === "undefined" || typeof EventSource === "undefined") {
        startPolling(publicKey, generation);
        return;
      }

      // The token may still need refreshing after a page reload.
      const token = await ensureAccessToken();
      if (generationRef.current !== generation) return;

      // Without a SEP-10 token there is nothing to connect to.
      if (!token) {
        startPolling(publicKey, generation);
        return;
      }

      const basePath = `${API_URL}/api/accounts/${encodeURIComponent(publicKey)}/stream`;
      let ticket: string;

      try {
        // Fetch a short-lived single-use ticket for the SSE connection
        const ticketRes = await apiFetch(`${basePath}/ticket`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (!ticketRes.ok) {
          throw new Error("Failed to get stream ticket");
        }

        const data = await ticketRes.json();
        ticket = data.ticket;
      } catch {
        // Fallback to polling if ticket generation fails
        startPolling(publicKey, generation);
        return;
      }

      if (generationRef.current !== generation) return;

      const url = `${basePath}?ticket=${encodeURIComponent(ticket)}`;

      let source: EventSource;
      try {
        source = new EventSource(url, { withCredentials: true });
      } catch {
        startPolling(publicKey, generation);
        return;
      }
      sourceRef.current = source;

      source.addEventListener("balance", (event) => {
        if (generationRef.current !== generation) return;
        try {
          const data = JSON.parse((event as MessageEvent).data);
          if (typeof data?.xlm === "string") {
            // The stream is authoritative — drop any pending optimistic delta
            // so the server value wins and the UI never double-counts a send
            // that already landed on-chain.
            setOptimisticDeltas(new Map());
            updateConfirmed(data.xlm, Date.now());
          }
        } catch {
          return;
        }
        // A delivered balance proves the stream works: stop polling and reset
        // the backoff so the next outage starts at 1s again.
        attemptRef.current = 0;
        stopPolling();
        setIsLive(true);
        isLiveRef.current = true;
        setStatus("live");
        setError(null);
      });

      // Soft, server-reported failures. These do not close the connection, so
      // they use a distinct event name from EventSource's transport `error`.
      source.addEventListener("stream-error", (event) => {
        if (generationRef.current !== generation) return;
        try {
          const data = JSON.parse((event as MessageEvent).data);
          setError(typeof data?.message === "string" ? data.message : "Stream error.");
        } catch {
          setError("Stream error.");
        }
      });

      source.onerror = () => {
        if (generationRef.current !== generation) return;

        closeSource();
        startPolling(publicKey, generation);
        // Transport is down: surface reconnecting (and let the stale timer
        // upgrade this to "stale" if it stays down long enough).
        setStatus((prev) => (prev === "live" ? "reconnecting" : prev));
        setIsLive(false);
        isLiveRef.current = false;

        clearReconnect();
        const delay = backoffDelay(attemptRef.current);
        attemptRef.current += 1;
        reconnectTimerRef.current = setTimeout(() => void connect(), delay);
      };
    };

    const teardown = () => {
      clearReconnect();
      stopPolling();
      closeSource();
    };

    // Invalidating the generation makes any in-flight poll a no-op, so nothing
    // sets state after the account changed or the hook unmounted.
    const teardownAndInvalidate = () => {
      generationRef.current += 1;
      teardown();
    };

    const handleVisibilityChange = () => {
      if (generationRef.current !== generation) return;

      if (document.hidden) {
        // Nothing is on screen to update — release the Horizon stream so the
        // server can close it when the last visible tab disconnects.
        teardown();
      } else {
        attemptRef.current = 0;
        void connect();
      }
    };

    if (typeof document !== "undefined" && document.hidden) {
      // Mounted in a background tab: wait until it is actually shown.
      document.addEventListener("visibilitychange", handleVisibilityChange);
      return () => {
        document.removeEventListener("visibilitychange", handleVisibilityChange);
        teardownAndInvalidate();
      };
    }

    void connect();
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      teardownAndInvalidate();
    };
  }, [publicKey, startPolling, stopPolling, updateConfirmed]);

  return {
    xlmBalance: xlmBalance(),
    confirmedXlmBalance,
    isLive,
    status,
    error,
    lastUpdatedAt,
    isOptimistic: optimisticDeltas.size > 0,
    optimisticXlmBalance,
    applyOptimisticDelta,
    rollbackOptimistic,
    reconcile,
  };
}

export default useBalanceStream;

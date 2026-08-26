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
 * Real-time reliability (#641):
 *   - `connectionState` distinguishes live (SSE delivering) / reconnecting
 *     (backoff in progress, stale value shown) / stale (polling fallback).
 *   - On a successful reconnect the hook reconciles against the authoritative
 *     balance so payments that landed while the stream was down are not lost.
 *   - Optimistic updates (`applyOptimisticBalance`/`rollbackOptimistic`) let
 *     callers reflect an in-flight send/claim immediately and revert to the
 *     last authoritative value on failure.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import { ensureAccessToken } from "@/lib/auth";
import { getXLMBalance } from "@/lib/stellar";

const POLL_INTERVAL_MS = 30_000;
const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;

const API_URL = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000").replace(
  /\/+$/,
  ""
);

export type ConnectionState = "live" | "reconnecting" | "stale";

export interface BalanceStream {
  xlmBalance: string;
  /** True while balance updates are arriving over SSE rather than polling. */
  isLive: boolean;
  /** live = SSE delivering · reconnecting = backoff pending · stale = polling. */
  connectionState: ConnectionState;
  error: string | null;
  /**
   * Timestamp of the last delivered balance, or null before the first one.
   * Lets callers tell "no value yet" apart from a genuine balance of "0".
   */
  lastUpdatedAt: number | null;
  /** True while an unconfirmed optimistic balance is being shown. */
  hasOptimisticUpdate: boolean;
  /**
   * Optimistically display `next` as the balance (an in-flight send/claim).
   * The next authoritative value (SSE/poll/reconcile) overrides it.
   */
  applyOptimisticBalance: (next: string) => void;
  /** Revert to the last authoritative value (call on a failed send/claim). */
  rollbackOptimistic: () => void;
  /** Fetch the authoritative balance and diff it against the shown one. */
  reconcile: () => Promise<void>;
}

function backoffDelay(attempt: number) {
  return Math.min(INITIAL_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS);
}

export function useBalanceStream(publicKey: string | null): BalanceStream {
  const [xlmBalance, setXlmBalance] = useState("0");
  const [isLive, setIsLive] = useState(false);
  // Live while SSE delivers · reconnecting while a backoff retry is pending
  // after a transport failure · stale for polling-only data.
  const [connectionState, setConnectionState] = useState<ConnectionState>("stale");
  const [error, setError] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  const [hasOptimisticUpdate, setHasOptimisticUpdate] = useState(false);

  const sourceRef = useRef<EventSource | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptRef = useRef(0);
  // Guards against a slow poll resolving after the account changed or the hook
  // unmounted and writing a balance that belongs to a different account.
  const generationRef = useRef(0);
  // Last balance confirmed by a server source (SSE event, poll, or reconcile).
  // Optimistic overrides are layered on top and dropped on rollback.
  const authoritativeRef = useRef("0");
  // Non-null while an optimistic update is being shown.
  const optimisticRef = useRef<string | null>(null);
  // Monotonic version of the authoritative value. A poll that started before a
  // reconnect won over by reconcile/SSE must not regress the newer value —
  // the version lets the late poll detect it lost the race (#641).
  const authoritativeVersionRef = useRef(0);

  /** Accept a server-confirmed balance: authoritative wins over optimistic. */
  const commitAuthoritative = useCallback((value: string, touchedAt: number) => {
    authoritativeVersionRef.current += 1;
    authoritativeRef.current = value;
    optimisticRef.current = null;
    setHasOptimisticUpdate(false);
    setXlmBalance(value);
    setLastUpdatedAt(touchedAt);
  }, []);

  const reconcile = useCallback(async (): Promise<void> => {
    if (!publicKey) return;
    const generation = generationRef.current;
    try {
      const balance = await getXLMBalance(publicKey);
      if (generationRef.current !== generation) return;
      commitAuthoritative(balance, Date.now());
      setError(null);
    } catch (err) {
      if (generationRef.current !== generation) return;
      setError(err instanceof Error ? err.message : "Failed to reconcile balance.");
    }
  }, [publicKey, commitAuthoritative]);

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
      setConnectionState("stale");
      if (pollTimerRef.current !== null) return;

      const poll = async () => {
        try {
          // Snapshot the authoritative version when the request starts. If a
          // reconnect's reconcile (or an SSE event) lands first, this poll
          // result is stale and must not regress the newer value (#641).
          const versionAtStart = authoritativeVersionRef.current;
          const balance = await getXLMBalance(key);
          if (generationRef.current !== generation) return;
          if (authoritativeVersionRef.current !== versionAtStart) return;
          commitAuthoritative(balance, Date.now());
          setError(null);
        } catch (err) {
          if (generationRef.current !== generation) return;
          setError(err instanceof Error ? err.message : "Failed to load balance.");
        }
      };

      void poll();
      pollTimerRef.current = setInterval(() => void poll(), POLL_INTERVAL_MS);
    },
    [commitAuthoritative]
  );

  useEffect(() => {
    const generation = generationRef.current + 1;
    generationRef.current = generation;

    if (!publicKey) {
      setXlmBalance("0");
      setIsLive(false);
      setConnectionState("stale");
      optimisticRef.current = null;
      setHasOptimisticUpdate(false);
      setError(null);
      setLastUpdatedAt(null);
      return;
    }

    const closeSource = () => {
      sourceRef.current?.close();
      sourceRef.current = null;
      setIsLive(false);
      setConnectionState("stale");
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
            commitAuthoritative(data.xlm, event.timeStamp || Date.now());
          }
        } catch {
          return;
        }
        // A delivered balance proves the stream works: stop polling and reset
        // the backoff so the next outage starts at 1s again.
        attemptRef.current = 0;
        stopPolling();
        setIsLive(true);
        setConnectionState("live");
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

      // Transport failure: mark the connection as reconnecting and schedule a
      // retry with exponential backoff. Polling keeps data fresh meanwhile.
      source.onerror = () => {
        if (generationRef.current !== generation) return;

        closeSource();
        startPolling(publicKey, generation);

        clearReconnect();
        const delay = backoffDelay(attemptRef.current);
        attemptRef.current += 1;
        setConnectionState("reconnecting");
        reconnectTimerRef.current = setTimeout(() => void connect(), delay);
      };

      // A reopened stream means the previous outage is over. Reconcile against
      // the authoritative balance so payments that landed while the stream was
      // down are reflected, and any duplicate poll events cannot regress it.
      source.onopen = () => {
        if (generationRef.current !== generation) return;
        setIsLive(true);
        setConnectionState("live");
        if (attemptRef.current > 0) {
          attemptRef.current = 0;
          stopPolling();
          void reconcile();
        }
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
  }, [publicKey, startPolling, stopPolling, commitAuthoritative, reconcile]);

  const applyOptimisticBalance = useCallback((next: string) => {
    optimisticRef.current = next;
    setHasOptimisticUpdate(true);
    setXlmBalance(next);
  }, []);

  const rollbackOptimistic = useCallback(() => {
    optimisticRef.current = null;
    setHasOptimisticUpdate(false);
    setXlmBalance(authoritativeRef.current);
  }, []);

  return {
    xlmBalance,
    isLive,
    connectionState,
    error,
    lastUpdatedAt,
    hasOptimisticUpdate,
    applyOptimisticBalance,
    rollbackOptimistic,
    reconcile,
  };
}

export default useBalanceStream;
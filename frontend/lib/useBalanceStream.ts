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
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { ensureAccessToken } from "@/lib/auth";
import { getXLMBalance } from "@/lib/stellar";

const POLL_INTERVAL_MS = 30_000;
const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;

const API_URL = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000").replace(
  /\/+$/,
  ""
);

export interface BalanceStream {
  xlmBalance: string;
  /** True while balance updates are arriving over SSE rather than polling. */
  isLive: boolean;
  error: string | null;
  /**
   * Timestamp of the last delivered balance, or null before the first one.
   * Lets callers tell "no value yet" apart from a genuine balance of "0".
   */
  lastUpdatedAt: number | null;
}

function backoffDelay(attempt: number) {
  return Math.min(INITIAL_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS);
}

export function useBalanceStream(publicKey: string | null): BalanceStream {
  const [xlmBalance, setXlmBalance] = useState("0");
  const [isLive, setIsLive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);

  const sourceRef = useRef<EventSource | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptRef = useRef(0);
  // Guards against a slow poll resolving after the account changed or the hook
  // unmounted and writing a balance that belongs to a different account.
  const generationRef = useRef(0);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current !== null) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const startPolling = useCallback(
    (key: string, generation: number) => {
      if (pollTimerRef.current !== null) return;

      const poll = async () => {
        try {
          const balance = await getXLMBalance(key);
          if (generationRef.current !== generation) return;
          setXlmBalance(balance);
          setLastUpdatedAt(Date.now());
          setError(null);
        } catch (err) {
          if (generationRef.current !== generation) return;
          setError(err instanceof Error ? err.message : "Failed to load balance.");
        }
      };

      void poll();
      pollTimerRef.current = setInterval(() => void poll(), POLL_INTERVAL_MS);
    },
    []
  );

  useEffect(() => {
    const generation = generationRef.current + 1;
    generationRef.current = generation;

    if (!publicKey) {
      setXlmBalance("0");
      setIsLive(false);
      setError(null);
      setLastUpdatedAt(null);
      return;
    }

    const closeSource = () => {
      sourceRef.current?.close();
      sourceRef.current = null;
      setIsLive(false);
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

      const url = `${API_URL}/api/accounts/${encodeURIComponent(
        publicKey
      )}/stream?token=${encodeURIComponent(token)}`;

      let source: EventSource;
      try {
        source = new EventSource(url);
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
            setXlmBalance(data.xlm);
            setLastUpdatedAt(Date.now());
          }
        } catch {
          return;
        }
        // A delivered balance proves the stream works: stop polling and reset
        // the backoff so the next outage starts at 1s again.
        attemptRef.current = 0;
        stopPolling();
        setIsLive(true);
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
  }, [publicKey, startPolling, stopPolling]);

  return { xlmBalance, isLive, error, lastUpdatedAt };
}

export default useBalanceStream;

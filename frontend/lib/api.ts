/**
 * @file lib/api.ts
 * @description API utilities, cursor-based pagination primitives, traceparent,
 * and correlation-ID context propagation for frontend HTTP requests.
 */

import { withCorrelation } from "./correlation";

/**
 * Generates a standard W3C traceparent header.
 * Format: 00-traceid-parentid-traceflags
 */
// frontend/lib/api.ts

/**
 * Generates a W3C Traceparent header.
 * Fixes Issue #725: Implements probabilistic sampling instead of hardcoded '01'.
 */
export function generateTraceParent(): string {
  const version = "00";
  const traceId = Math.random().toString(16).substring(2, 18) + Math.random().toString(16).substring(2, 18);
  const parentId = Math.random().toString(16).substring(2, 18);

  // Define sampling rate (e.g., 0.1 for 10% of requests, or 1.0 for 100%)
  // Ideally, this value comes from an environment variable
  const samplingRate = process.env.NEXT_PUBLIC_TRACE_SAMPLING_RATE 
    ? parseFloat(process.env.NEXT_PUBLIC_TRACE_SAMPLING_RATE) 
    : 0.1; // Default to 10% to prevent backend overload

  // Determine trace flags
  // 01 = Sampled, 00 = Not Sampled
  const isSampled = Math.random() < samplingRate;
  const traceFlags = isSampled ? "01" : "00";

  return `${version}-${traceId}-${parentId}-${traceFlags}`;
}
/**
 * A wrapper around the native fetch API that automatically adds
 * traceparent headers for outgoing request tracing.
 */
export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  if (!headers.has("traceparent")) {
    headers.set("traceparent", generateTraceParent());
  }
  return withCorrelation(fetch)(input, {
    ...init,
    headers,
  });
}

/**
 * Determines whether an outgoing request targets the application's own backend
 * API and is therefore safe to receive W3C `traceparent` context.
 *
 * `traceparent` carries internal distributed-tracing context that must never
 * leave first-party infrastructure. The previous heuristic injected it into any
 * URL whose string merely *contained* `/api/` (e.g.
 * `https://api.coingecko.com/api/v3/...`), leaking trace context to third-party
 * hosts. We now restrict injection to:
 *   1. relative paths (same-origin to the frontend), and
 *   2. absolute URLs whose origin exactly matches the configured backend API
 *      origin (`NEXT_PUBLIC_API_URL`).
 *
 * @param urlStr the request URL as a string, URL, or Request
 */
function isFirstPartyApiRequest(urlStr: string): boolean {
  // Relative URLs (e.g. "/api/health") are same-origin to the frontend and are
  // always treated as first-party.
  if (!/^https?:\/\//i.test(urlStr)) {
    return true;
  }

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
  let backendOrigin: string | null = null;
  try {
    backendOrigin = new URL(apiUrl).origin;
  } catch {
    backendOrigin = null;
  }
  if (!backendOrigin) {
    // Without a resolvable backend origin we must not assume a third-party host
    // is first-party, so never inject trace context.
    return false;
  }

  try {
    return new URL(urlStr).origin === backendOrigin;
  } catch {
    return false;
  }
}

// Automatically patch global fetch for backend API calls made outside apiFetch.
// Uses a self-executing function to avoid top-level typeof checks that conflict
// with certain tsconfig lib configurations.
(function patchGlobalFetch() {
  const globalObj = (typeof window !== "undefined" ? window : globalThis) as typeof globalThis & {
    __correlationFetchPatched?: boolean;
  };

  if (globalObj && !globalObj.__correlationFetchPatched) {
    const originalFetch = globalObj.fetch?.bind(globalObj);
    if (originalFetch) {
      const correlatedFetch = withCorrelation(originalFetch);
      globalObj.fetch = async function (input: RequestInfo | URL, init?: RequestInit) {
        const urlStr =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : (input as Request).url;

        // Only inject traceparent headers for first-party backend requests.
        if (isFirstPartyApiRequest(urlStr)) {
          const headers = new Headers(init?.headers);
          if (!headers.has("traceparent")) {
            headers.set("traceparent", generateTraceParent());
          }
          return correlatedFetch(input, {
            ...init,
            headers,
          });
        }

        return originalFetch(input, init);
      };
      globalObj.__correlationFetchPatched = true;
    }
  }
})();

// ─── Cursor pagination ───────────────────────────────────────────────────────

/**
 * Query-string key used to carry the pagination cursor in the URL, e.g.
 * `/transactions?cursor=<paging-token>`.
 */
export const CURSOR_QUERY_KEY = "cursor";

/**
 * Meta information about a single cursor page load. The page layer uses this to
 * keep the URL (`?cursor=...`) in sync so reloads and deep links resume at the
 * exact same position instead of skipping or duplicating rows.
 */
export interface CursorPageInfo {
  /** The cursor that was used to load the currently displayed page. */
  cursorUsed?: string;
  /** The cursor that must be passed to the next call to load older records. */
  nextCursor?: string;
  /** Whether older records still exist after this page. */
  hasMore: boolean;
}

/**
 * Encode a cursor so it is safe to embed in a URL query string. Horizon paging
 * tokens are already URL-safe in practice, but defensively base64url-encode so
 * custom cursors with reserved characters cannot break the query parsing.
 */
export function encodeCursor(cursor: string): string {
  const clean = cursor.trim();
  if (!clean) return clean;

  try {
    const bytes = new TextEncoder().encode(clean);
    let binary = "";
    bytes.forEach((byte) => (binary += String.fromCharCode(byte)));
    if (typeof btoa === "function") {
      return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    }
  } catch {
    // Fall through to the identity path below for wide strings.
  }
  return clean;
}

/** Inverse of {@link encodeCursor}. Passes through plain tokens unchanged. */
export function decodeCursor(encoded: string): string {
  const clean = encoded.trim();
  if (!clean) return clean;

  try {
    if (typeof atob === "function") {
      const b64 = clean.replace(/-/g, "+").replace(/_/g, "/");
      const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
      const binary = atob(padded);
      const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
      return new TextDecoder().decode(bytes);
    }
  } catch {
    // Not a base64url payload; treat it as a plain token.
  }
  return clean;
}

/**
 * Pull the pagination cursor out of a query-string source.
 *
 * @example
 * readCursorFromQuery(new URLSearchParams("cursor=abc&x=1")); // => "abc"
 */
export function readCursorFromQuery(
  search: string | URLSearchParams | Record<string, unknown> | null | undefined,
): string | undefined {
  let raw: string | undefined;
  if (typeof search === "string") {
    raw = new URLSearchParams(search).get(CURSOR_QUERY_KEY) ?? undefined;
  } else if (search instanceof URLSearchParams) {
    raw = search.get(CURSOR_QUERY_KEY) ?? undefined;
  } else if (search && typeof search === "object") {
    const value = (search as Record<string, unknown>)[CURSOR_QUERY_KEY];
    raw = Array.isArray(value) ? (value[0] as string) : (value as string);
  }
  if (raw == null || raw === "") return undefined;
  return decodeCursor(raw);
}

/**
 * Return `url` with the `cursor` query parameter updated to `cursor`.
 * Passing `undefined` removes the parameter entirely and preserves every other
 * query parameter, which is what keeps filters/search URL-safe.
 */
export function updateCursorInUrl(url: string, cursor: string | undefined): string {
  const [base = "", search = ""] = url.split("?");
  const params = new URLSearchParams(search);
  if (cursor == null || cursor === "") {
    params.delete(CURSOR_QUERY_KEY);
  } else {
    params.set(CURSOR_QUERY_KEY, encodeCursor(cursor));
  }
  const qs = params.toString();
  return qs.length > 0 ? `${base}?${qs}` : base;
}

/** Remove records that share the same `id`, preserving first-seen order. */
export function dedupeById<T extends { id: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    result.push(row);
  }
  return result;
}

/**
 * Merge an incoming (older) cursor page into the currently loaded records.
 *
 * Pages arrive newest-first and strictly older than the previous page, so a
 * simple append is correct; `dedupeById` guards against the (rare) Horizon
 * cases where a paging token moves underneath us so we never render a
 * transaction twice.
 */
export function mergeRecordPages<T extends { id: string }>(current: T[], incoming: T[]): T[] {
  return dedupeById([...current, ...incoming]);
}

/**
 * Reconcile a freshly fetched (newest) page with the records already loaded.
 * New transactions that arrived while paginating are prepended without
 * disturbing the cursor-anchored pages below them.
 */
export function prependNewestUnique<T extends { id: string }>(existing: T[], fresh: T[]): T[] {
  return dedupeById([...fresh, ...existing]);
}

export interface CursorSlice<T extends { id: string; pagingToken?: string }> {
  records: T[];
  nextCursor?: string;
  hasMore: boolean;
}

/**
 * Deterministically slice a newest-first dataset using a cursor.
 *
 * The cursor is resolved against `pagingToken` values rather than array
 * offsets, which is what makes the pagination stable when new transactions are
 * inserted at the front of the dataset between page requests — pages neither
 * skip nor repeat rows.
 */
export function cursorSlice<T extends { id: string; pagingToken?: string }>(
  records: T[],
  limit: number,
  cursor?: string,
): CursorSlice<T> {
  const safeLimit = Math.max(1, Math.floor(limit) || 1);
  if (records.length === 0) {
    return { records: [], nextCursor: undefined, hasMore: false };
  }

  let startIndex = 0;
  if (cursor != null && cursor !== "") {
    const anchorIndex = records.findIndex((r) => r.pagingToken === cursor);
    // Cursor resolved past the end (oldest records trimmed) => no more records.
    if (anchorIndex === -1) {
      return { records: [], nextCursor: undefined, hasMore: false };
    }
    startIndex = anchorIndex + 1;
  }

  const endIndex = Math.min(records.length, startIndex + safeLimit);
  const page = records.slice(startIndex, endIndex);
  const hasMore = endIndex < records.length;
  const last = page[page.length - 1];
  return {
    records: page,
    nextCursor: hasMore ? last.pagingToken : undefined,
    hasMore,
  };
}

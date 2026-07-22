/**
 * lib/correlation.ts
 * Frontend correlation IDs for tracing user actions across the stack.
 *
 * - `X-Session-ID`: stable for the browser tab lifetime
 * - `X-Request-ID`: unique per user-initiated action / fetch
 *
 * Override `window.fetch` (via `installCorrelationFetch`) so every API call
 * carries both headers without touching each call site.
 */

let sessionId =
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `sess-${Date.now()}-${Math.random().toString(36).slice(2)}`;

/** Most recent action / request ID (updated by createActionId / withCorrelation). */
let lastActionId: string | null = null;

function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Stable session ID for this browser tab. */
export function getSessionId(): string {
  return sessionId;
}

/** Create a new per-action correlation ID and remember it for Sentry / RPC logs. */
export function createActionId(): string {
  lastActionId = newId();
  return lastActionId;
}

/** Last action ID, or the session ID when no action has been created yet. */
export function getCorrelationId(): string {
  return lastActionId || sessionId;
}

/** Last action ID only (may be null before the first correlated fetch). */
export function getLastActionId(): string | null {
  return lastActionId;
}

/** Headers to attach to outbound API / RPC-related traffic. */
export function getCorrelationHeaders(): Record<string, string> {
  return {
    "X-Request-ID": createActionId(),
    "X-Session-ID": sessionId,
  };
}

/**
 * Wrap a fetch implementation so every call sends correlation headers.
 * Existing caller headers win only if they already set these keys — we
 * always set fresh action IDs unless `X-Request-ID` is already present.
 */
export function withCorrelation(
  fetchImpl: typeof fetch,
): typeof fetch {
  return (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const headers = new Headers(init?.headers);

    if (!headers.has("X-Request-ID")) {
      headers.set("X-Request-ID", createActionId());
    } else {
      lastActionId = headers.get("X-Request-ID");
    }

    if (!headers.has("X-Session-ID")) {
      headers.set("X-Session-ID", sessionId);
    }

    return fetchImpl(input, { ...init, headers });
  };
}

let installed = false;

/**
 * Install a global `window.fetch` wrapper (idempotent).
 * Call once from the app entry point on the client.
 */
export function installCorrelationFetch(): void {
  if (typeof window === "undefined" || installed) return;
  window.fetch = withCorrelation(window.fetch.bind(window));
  installed = true;
}

/**
 * Structured console log for Horizon / Soroban RPC calls that cannot carry
 * custom HTTP headers through the Stellar SDK.
 */
export function logRpcCorrelation(
  target: "horizon" | "soroban",
  operation: string,
  extra?: Record<string, unknown>,
): void {
  const payload = {
    level: "INFO",
    msg: `${target} RPC call`,
    correlationId: getCorrelationId(),
    sessionId: getSessionId(),
    target,
    operation,
    ...extra,
  };
  // Prefer structured JSON so browser/devtools log drains can parse it.
  console.info(JSON.stringify(payload));
}

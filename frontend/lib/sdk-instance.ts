/**
 * lib/sdk-instance.ts
 * Shared FinchippayClient instance for the frontend.
 */

import { FinchippayClient } from "@finchippay/sdk";
import { withAuth } from "./auth";
import { installCorrelationFetch, withCorrelation } from "@/lib/correlation";

/** Base URL for the Finchippay API */
const API_URL =
  (process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000").replace(/\/+$/, "");

// Install the global fetch wrapper as early as this module loads on the client
// so both raw fetch and the SDK see X-Request-ID / X-Session-ID.
if (typeof window !== "undefined") {
  installCorrelationFetch();
}

const baseFetch: typeof fetch =
  typeof window !== "undefined"
    ? ((input, init) => window.fetch(input, init)) as typeof fetch
    : typeof globalThis.fetch === "function"
      ? withCorrelation(globalThis.fetch.bind(globalThis))
      : (globalThis.fetch as typeof fetch);

/** Singleton SDK instance shared across the frontend. */
export const sdk = new FinchippayClient({
  baseUrl: API_URL,
  cacheToken: false,
  // Auth refresh + correlation: withAuth wraps the (already correlated) fetch.
  fetch:
    typeof window !== "undefined"
      ? withAuth(baseFetch)
      : baseFetch,
});

/**
 * Initialize the SDK auth. Called once on app startup.
 */
export function initSdkAuth(): void {
  // Using two-token rotation; withAuth will fetch and refresh as needed.
}

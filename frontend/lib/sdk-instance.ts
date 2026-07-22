/**
 * lib/sdk-instance.ts
 * Shared FinchippayClient instance for the frontend.
 *
 * This module creates and exports a singeton SDK client pre-configured
 * with the API base URL from environment variables. The frontend uses
 * this instance for all backend API calls.
 *
 * This is part of "dogfooding" — using our own SDK in production to
 * ensure it stays correct as the API evolves.
 */

import { FinchippayClient } from "@finchippay/sdk";
import { installCorrelationFetch, withCorrelation } from "@/lib/correlation";

/** Base URL for the Finchippay API */
const API_URL =
  (process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000").replace(/\/+$/, "");

// Install the global fetch wrapper as early as this module loads on the client
// so both raw fetch and the SDK see X-Request-ID / X-Session-ID.
if (typeof window !== "undefined") {
  installCorrelationFetch();
}

const correlatedFetch: typeof fetch =
  typeof window !== "undefined"
    ? ((input, init) => window.fetch(input, init)) as typeof fetch
    : typeof globalThis.fetch === "function"
      ? withCorrelation(globalThis.fetch.bind(globalThis))
      : (globalThis.fetch as typeof fetch);

/** Singleton SDK instance shared across the frontend. */
export const sdk = new FinchippayClient({
  baseUrl: API_URL,
  /**
   * The frontend manages auth tokens separately via wallet.ts (SEP-0010).
   * We pass the token via setToken() after authentication so the SDK
   * automatically attaches the Authorization header to subsequent requests.
   */
  cacheToken: false,
  // Always delegate to the current global fetch (post-correlation wrap).
  fetch: correlatedFetch,
});

/**
 * Initialize the SDK with the JWT token from local storage (if any).
 * Call this once on app startup.
 */
export function initSdkAuth(): void {
  if (typeof window !== "undefined") {
    const token = localStorage.getItem("finchippay_auth_token");
    if (token) {
      sdk.setToken(token);
    }
  }
}
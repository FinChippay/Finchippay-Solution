/**
 * lib/sdk-instance.ts
 * Shared FinchippayClient instance for the frontend.
 */

import { FinchippayClient } from "@finchippay/sdk";
import { withAuth } from "./auth";

/** Lazily-resolved base URL for the Finchippay API.
 *  Resolved per request so test suites can set NEXT_PUBLIC_API_URL after module load. */
function resolveApiUrl(): string {
  return (process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000").replace(/\/+$/, "");
}

/**
 * Resolve the fetch implementation at call time.
 *
 * The browser build binds the authenticated `window.fetch`; jsdom test suites
 * (which mock `global.fetch`/`window.fetch` after import) get their mock. A
 * lazy wrapper keeps `FinchippayClient` constructible in every environment
 * instead of throwing at module load when fetch is momentarily absent.
 */
function resolveBaseFetch(): typeof fetch | undefined {
  if (typeof window !== "undefined" && typeof window.fetch === "function") {
    return withAuth(window.fetch.bind(window));
  }
  if (typeof globalThis.fetch === "function") {
    return globalThis.fetch.bind(globalThis) as typeof fetch;
  }
  return undefined;
}

const lazyFetch: typeof fetch = (input, init) => {
  const base = resolveBaseFetch();
  if (!base) {
    throw new Error(
      "Fetch API is not available. Pass a custom fetch implementation via the `fetch` option, or use Node.js 18+."
    );
  }
  return base(input, init);
};

const _sdk = new FinchippayClient({
  baseUrl: resolveApiUrl(),
  cacheToken: false,
  fetch: lazyFetch,
});

/**
 * Proxy that lazily syncs the base URL from env before every property access.
 * In production the env var is constant, so `setBaseUrl` is effectively a no-op
 * (same string). In test suites that set NEXT_PUBLIC_API_URL after module load,
 * the first SDK call picks up the correct URL.
 */
export const sdk = new Proxy(_sdk, {
  get(target, prop) {
    target.setBaseUrl(resolveApiUrl());
    return (target as never)[prop];
  },
});

/**
 * Initialize the SDK auth. Called once on app startup.
 */
export function initSdkAuth(): void {
  // Using two-token rotation; withAuth will fetch and refresh as needed.
}
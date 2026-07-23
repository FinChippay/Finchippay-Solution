/**
 * lib/sdk-instance.ts
 * Shared FinchippayClient instance for the frontend.
 */

import { FinchippayClient } from "@finchippay/sdk";
import { withAuth } from "./auth";

/** Base URL for the Finchippay API */
const API_URL =
  (process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000").replace(/\/+$/, "");

/** Singleton SDK instance shared across the frontend. */
export const sdk = new FinchippayClient({
  baseUrl: API_URL,
  cacheToken: false,
  fetch: typeof window !== "undefined" ? withAuth(window.fetch.bind(window)) : undefined,
});

/**
 * Initialize the SDK auth. Called once on app startup.
 */
export function initSdkAuth(): void {
  // Using two-token rotation; withAuth will fetch and refresh as needed.
}
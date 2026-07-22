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

/** Base URL for the Finchippay API */
const API_URL =
  (process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000").replace(/\/+$/, "");

/** Singleton SDK instance shared across the frontend. */
export const sdk = new FinchippayClient({
  baseUrl: API_URL,
  /**
   * The frontend manages auth tokens separately via wallet.ts (SEP-0010).
   * We pass the token via setToken() after authentication so the SDK
   * automatically attaches the Authorization header to subsequent requests.
   */
  cacheToken: false,
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
/**
 * lib/sdk-instance.ts
 * Type-safe SDK client instance for Finchippay API calls.
 *
 * Re-exports the central apiClient instance from @/lib/api dogfooding @finchippay/sdk.
 */

import { apiClient } from "./api";

export const sdk = apiClient;
export { apiClient };

/** Initialize SDK authentication from stored token. */
export function initSdkAuth(): void {
  // Authentication is dynamically resolved via ensureAccessToken() in apiClient
}

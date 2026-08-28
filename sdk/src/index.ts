/**
 * @finchippay/sdk — TypeScript client library for the Finchippay Solution API.
 *
 * # Quick Start
 *
 * ```ts
 * import { FinchippayClient } from "@finchippay/sdk";
 *
 * const sdk = new FinchippayClient({ baseUrl: "http://localhost:4000" });
 *
 * // 1. Check server health
 * const health = await sdk.health();
 * console.log("Server:", health.status);
 *
 * // 2. Get account balance (public endpoint)
 * const { data } = await sdk.accounts.getBalance(
 *   "GDZESYKG34O2LNG5V6KQZ4J5R5HDS7R5Y7P3G4J6K7L8M9N0O1P2Q3R4S5T6U"
 * );
 * console.log("Balance:", data.balance);
 *
 * // 3. Authenticate via SEP-0010 (if needed for protected endpoints)
 * const challenge = await sdk.getChallenge("G...");
 * // Sign challengeXDR with user's Stellar keypair, then:
 * const { token } = await sdk.verifyChallenge(signedXDR);
 *
 * // 4. Fetch payment history
 * const payments = await sdk.payments.getHistory("G...", { limit: 10 });
 * ```
 *
 * @module
 */

export { FinchippayClient } from "./client";
export { ApiHttpError } from "./client";
export type { FinchippayClientOptions } from "./client";

export type * from "./types";
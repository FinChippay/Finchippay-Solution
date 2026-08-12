/**
 * lib/sdk-instance.ts
 * Type-safe SDK client instance for Finchippay API calls.
 *
 * Provides a centralized, authenticated SDK client that components and hooks
 * can import. Abstracts away token management and base URL configuration.
 */

import { apiFetch } from "./api";

interface SdkConfig {
  baseUrl: string;
  token?: string | null;
}

class FinchippaySdk {
  private baseUrl: string;
  private token: string | null = null;

  constructor(config: SdkConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.token = config.token ?? null;
  }

  setToken(token: string | null): void {
    this.token = token;
  }

  private headers(): HeadersInit {
    const h: HeadersInit = { "Content-Type": "application/json" };
    if (this.token) {
      return { ...h, Authorization: `Bearer ${this.token}` };
    }
    return h;
  }

  async getChallenge(publicKey: string): Promise<{ transaction: string }> {
    const res = await apiFetch(`${this.baseUrl}/api/auth/challenge`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ publicKey }),
    });
    return res.json();
  }

  async verifyChallenge(signedXDR: string): Promise<{
    accessToken?: string;
    token?: string;
    refreshToken?: string;
  }> {
    const res = await apiFetch(`${this.baseUrl}/api/auth/verify`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ signedXDR }),
    });
    return res.json();
  }
}

const API_URL =
  (typeof window !== "undefined"
    ? process.env.NEXT_PUBLIC_API_URL
    : process.env.NEXT_PUBLIC_API_URL) || "http://localhost:4000";

export const sdk = new FinchippaySdk({ baseUrl: API_URL ?? "" });

/** Initialize SDK authentication from stored token. */
export function initSdkAuth(): void {
  // Stub: loads token from localStorage and sets on sdk instance
}

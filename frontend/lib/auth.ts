/**
 * lib/auth.ts
 * Authentication helpers for API calls.
 */

import { logger } from "@/lib/logger";

let inMemoryAccessToken: string | null = null;
let refreshPromise: Promise<string | null> | null = null;

export function getJwtToken(): string | null {
  return inMemoryAccessToken;
}

export function setJwtToken(token: string | null): void {
  inMemoryAccessToken = token;
}

/**
 * Returns a non-null sentinel value when a session flag exists in localStorage.
 * The actual refresh token is never stored in the client — /api/auth/refresh
 * relies on the backend's httpOnly cookie. A boolean flag is kept so the app
 * can attempt a refresh right after a page reload without a 401-first round
 * trip.
 */
export function getRefreshToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("finchippay_has_session") ? "true" : null;
}

export function setRefreshToken(token: string | null): void {
  if (typeof window !== "undefined") {
    if (token) {
      localStorage.setItem("finchippay_has_session", "true");
    } else {
      localStorage.removeItem("finchippay_has_session");
    }
    // Defence-in-depth: purge any legacy residual refresh-token key from
    // earlier versions. Nothing in the current codebase ever writes it.
    localStorage.removeItem("finchippay_refresh_token");
  }
}

export function clearJwtToken(): void {
  inMemoryAccessToken = null;
  if (typeof window !== "undefined") {
    localStorage.removeItem("finchippay_has_session");
    // Purge any legacy residual key from versions that stored the token.
    localStorage.removeItem("finchippay_refresh_token");
  }
}

/**
 * Performs token refresh call. Returns the new access token, or null on failure.
 */
async function performRefresh(): Promise<string | null> {
  const rToken = getRefreshToken();
  if (!rToken) return null;

  const API_URL = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000").replace(/\/+$/, "");
  try {
    const res = await fetch(`${API_URL}/api/auth/refresh`, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (res.ok) {
      const payload = await res.json();
      const data = payload.data || payload;
      const newAccess = data.accessToken || data.token;
      const newRefresh = data.refreshToken;

      if (newAccess) {
        setJwtToken(newAccess);
        if (newRefresh) {
          setRefreshToken(newRefresh);
        }
        return newAccess;
      }
    }
  } catch (err) {
    logger.error("Token refresh failed", { apiUrl: API_URL }, err instanceof Error ? err : new Error(String(err)));
  }

  clearJwtToken();
  return null;
}

/**
 * Share refresh promise across concurrent requests
 */
function refreshTokens(): Promise<string | null> {
  if (!refreshPromise) {
    refreshPromise = performRefresh().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

/**
 * Return a usable access token, refreshing from the stored refresh token if the
 * in-memory one is missing (e.g. right after a page reload). Returns null when
 * the user is not authenticated.
 *
 * `withAuth` does this implicitly for fetch calls; callers that build a URL
 * themselves — such as the SSE balance stream, since `EventSource` cannot set
 * an Authorization header — need it explicitly.
 */
export async function ensureAccessToken(): Promise<string | null> {
  if (inMemoryAccessToken) return inMemoryAccessToken;
  if (!getRefreshToken()) return null;
  return refreshTokens();
}

/**
 * withAuth wrapper that catches 401, calls /api/auth/refresh, and retries.
 */
export function withAuth(fetchFn: typeof fetch): typeof fetch {
  return async (input, init) => {
    const reqInit = init || {};
    const headers = new Headers(reqInit.headers || {});

    // Try to pre-populate Authorization if we have access token in memory
    if (!headers.has("Authorization") && inMemoryAccessToken) {
      headers.set("Authorization", `Bearer ${inMemoryAccessToken}`);
    }

    // Preemptive refresh if no access token but refresh token exists
    if (!headers.has("Authorization") && !inMemoryAccessToken && getRefreshToken()) {
      const freshToken = await refreshTokens();
      if (freshToken) {
        headers.set("Authorization", `Bearer ${freshToken}`);
      }
    }

    reqInit.headers = headers;
    const response = await fetchFn(input, reqInit);

    // If unauthorized, attempt to refresh and retry
    if (response.status === 401 && !(reqInit as any)._isRetry) {
      const freshToken = await refreshTokens();
      if (freshToken) {
        const retryHeaders = new Headers(reqInit.headers);
        retryHeaders.set("Authorization", `Bearer ${freshToken}`);
        reqInit.headers = retryHeaders;
        (reqInit as any)._isRetry = true;
        return await fetchFn(input, reqInit);
      } else {
        // Redirect to wallet connect flow
        if (typeof window !== "undefined" && window.location.pathname !== "/") {
          window.location.href = "/";
        }
      }
    }

    return response;
  };
}

/**
 * Return a guaranteed valid access token, refreshing automatically if needed.
 */
export async function getAccessToken(): Promise<string | null> {
  return ensureAccessToken();
}

export type { SessionInfo } from "@finchippay/sdk";

/**
 * Get active sessions for current user
 */
export async function getSessions(): Promise<import("@finchippay/sdk").SessionInfo[]> {
  const token = await ensureAccessToken();
  if (!token) return [];

  try {
    const { apiClient } = await import("./api");
    return await apiClient.auth.getSessions();
  } catch (err) {
    logger.error("Failed to fetch sessions", {}, err instanceof Error ? err : undefined);
  }
  return [];
}

/**
 * Revoke specific session by session ID
 */
export async function revokeSession(sessionId: number | string): Promise<boolean> {
  const token = await ensureAccessToken();
  if (!token) return false;

  try {
    const res = await fetch(`${API_URL}/api/auth/revoke`, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ sessionId }),
    });
    if (res.ok) {
      const data = await res.json();
      return Boolean(data.success);
    }
  } catch (err) {
    logger.error("Failed to revoke session", { sessionId: String(sessionId) }, err instanceof Error ? err : undefined);
  }
  return false;
}

/**
 * Revoke all active sessions for current user
 */
export async function revokeAllSessions(): Promise<boolean> {
  const token = await ensureAccessToken();
  if (!token) return false;

  try {
    const res = await fetch(`${API_URL}/api/auth/revoke`, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ all: true }),
    });
    if (res.ok) {
      clearJwtToken();
      return true;
    }
  } catch (err) {
    logger.error("Failed to revoke all sessions", {}, err instanceof Error ? err : undefined);
  }
  return false;
}


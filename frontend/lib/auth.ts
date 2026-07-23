/**
 * lib/auth.ts
 * Authentication helpers for API calls.
 */

let inMemoryAccessToken: string | null = null;
let refreshPromise: Promise<string | null> | null = null;

export function getJwtToken(): string | null {
  return inMemoryAccessToken;
}

export function setJwtToken(token: string | null): void {
  inMemoryAccessToken = token;
}

export function getRefreshToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("finchippay_refresh_token");
}

export function setRefreshToken(token: string | null): void {
  if (typeof window !== "undefined") {
    if (token) {
      localStorage.setItem("finchippay_refresh_token", token);
    } else {
      localStorage.removeItem("finchippay_refresh_token");
    }
  }
}

export function clearJwtToken(): void {
  inMemoryAccessToken = null;
  if (typeof window !== "undefined") {
    localStorage.removeItem("finchippay_refresh_token");
  }
}

/**
 * Performs token refresh call. Returns the new access token, or null on failure.
 */
async function performRefresh(): Promise<string | null> {
  const rToken = getRefreshToken();
  if (!rToken) return null;

  try {
    const API_URL = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000").replace(/\/+$/, "");
    const res = await fetch(`${API_URL}/api/auth/refresh`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ refreshToken: rToken }),
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
    console.error("Token refresh failed:", err);
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
 * withAuth wrapper that catches 401, calls /api/auth/refresh, and retries.
 */
export function withAuth(fetchFn: typeof fetch): typeof fetch {
  return async (input, init) => {
    let reqInit = init || {};
    let headers = new Headers(reqInit.headers || {});

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
    let response = await fetchFn(input, reqInit);

    // If unauthorized, attempt to refresh and retry
    if (response.status === 401) {
      const freshToken = await refreshTokens();
      if (freshToken) {
        let retryHeaders = new Headers(reqInit.headers);
        retryHeaders.set("Authorization", `Bearer ${freshToken}`);
        reqInit.headers = retryHeaders;
        return await fetchFn(input, reqInit);
      } else {
        // Redirect to wallet connect flow
        if (typeof window !== "undefined") {
          window.location.href = "/";
        }
      }
    }

    return response;
  };
}

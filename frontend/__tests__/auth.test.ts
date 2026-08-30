/**
 * __tests__/auth.test.ts
 * Security regression tests: the refresh token must never be persisted to
 * localStorage. Refresh relies on the backend's httpOnly cookie via
 * `credentials: "include"`, and the client only keeps a boolean "has session"
 * flag so it can attempt a refresh after a page reload.
 */

jest.mock("@/lib/logger", () => ({
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));

global.fetch = jest.fn();

import {
  getRefreshToken,
  setRefreshToken,
  clearJwtToken,
  setJwtToken,
  getJwtToken,
  ensureAccessToken,
  withAuth,
} from "@/lib/auth";

const REFRESH_TOKEN_KEY = "finchippay_refresh_token";
const HAS_SESSION_KEY = "finchippay_has_session";

describe("auth refresh-token storage policy", () => {
  beforeEach(() => {
    localStorage.clear();
    setJwtToken(null);
    (global.fetch as jest.Mock).mockClear();
  });

  it("never writes the refresh token itself to localStorage", () => {
    setRefreshToken("super-secret-refresh-token");
    expect(localStorage.getItem(REFRESH_TOKEN_KEY)).toBeNull();
    expect(localStorage.getItem(HAS_SESSION_KEY)).toBe("true");
  });

  it("tracks session presence via a boolean flag, not the token", () => {
    setRefreshToken("refresh-abc");
    expect(getRefreshToken()).not.toBeNull();
    expect(getRefreshToken()).not.toContain("refresh-abc");
  });

  it("clearJwtToken removes the session flag and any residual token key", () => {
    localStorage.setItem(REFRESH_TOKEN_KEY, "should-be-purged");
    setRefreshToken("refresh-xyz");
    clearJwtToken();
    expect(localStorage.getItem(HAS_SESSION_KEY)).toBeNull();
    expect(localStorage.getItem(REFRESH_TOKEN_KEY)).toBeNull();
    expect(getJwtToken()).toBeNull();
  });

  it("setRefreshToken(null) clears the session flag", () => {
    setRefreshToken("refresh-abc");
    setRefreshToken(null);
    expect(localStorage.getItem(HAS_SESSION_KEY)).toBeNull();
    expect(getRefreshToken()).toBeNull();
  });

  it("clears only the flag when no session is present", () => {
    localStorage.setItem(HAS_SESSION_KEY, "true");
    localStorage.setItem(REFRESH_TOKEN_KEY, "stale");
    clearJwtToken();
    expect(localStorage.getItem(REFRESH_TOKEN_KEY)).toBeNull();
    expect(localStorage.getItem(HAS_SESSION_KEY)).toBeNull();
  });
});

describe("auth refresh flow via httpOnly cookie", () => {
  const API_URL = "http://localhost:4000";

  beforeEach(() => {
    localStorage.clear();
    setJwtToken(null);
    (global.fetch as jest.Mock).mockReset();
  });

  it("refreshes through the cookie endpoint with credentials include, no stored token", async () => {
    // No in-memory token and no session flag → ensureAccessToken returns null
    // without firing a network call.
    const before = await ensureAccessToken();
    expect(before).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("calls /api/auth/refresh with credentials include when a session exists", async () => {
    setRefreshToken("dummy-flag"); // sets the has-session flag, never the token
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ data: { accessToken: "new-access-token" } }),
    });

    const token = await ensureAccessToken();

    expect(token).toBe("new-access-token");
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(String(url)).toContain("/api/auth/refresh");
    expect((init as RequestInit).credentials).toBe("include");
    // The refresh token must not be sent as a header or body — it rides in the
    // httpOnly cookie only.
    expect(JSON.stringify(init)).not.toContain("refresh");
  });

  it("withAuth performs a preemptive refresh via cookie when only a session flag exists", async () => {
    setRefreshToken("dummy-flag");
    const fetchFn = jest.fn().mockResolvedValue({ ok: true, status: 200 });

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ data: { accessToken: "pre-fresh" } }),
    });

    await withAuth(fetchFn as unknown as typeof fetch)("http://example.com", {});

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/auth/refresh"),
      expect.objectContaining({ credentials: "include" })
    );
  });
});

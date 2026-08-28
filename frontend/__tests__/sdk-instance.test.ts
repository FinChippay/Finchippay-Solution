/**
 * Tests for lib/sdk-instance.ts
 *
 * Verifies the SDK auth endpoint alignment with the real SEP-10 backend:
 * - getChallenge → GET /api/auth?account=G...
 * - verifyChallenge → POST /api/auth with { transaction: signedXDR }
 * - initSdkAuth → loads token from getJwtToken() and calls sdk.setToken()
 */

import { apiFetch } from "@/lib/api";
import { getJwtToken } from "@/lib/auth";

// Mock the api and auth modules
jest.mock("@/lib/api", () => ({
  apiClient: {},
  apiFetch: jest.fn(),
}));

jest.mock("@/lib/auth", () => ({
  getJwtToken: jest.fn(),
}));

// Re-import so the mocks are in place before the module is evaluated
const sdkModule = require("@/lib/sdk-instance");

describe("FinchippaySdk auth endpoints", () => {
  const mockFetch = apiFetch as jest.MockedFunction<typeof apiFetch>;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("getChallenge", () => {
    it("calls GET /api/auth?account= with the public key", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ transaction: "challenge_xdr", networkPassphrase: "Test SDF Network ; September 2015" }),
      } as Response);

      const result = await sdkModule.sdk.getChallenge("GABCDEF123456");

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toContain("/api/auth?account=GABCDEF123456");
      expect(opts?.method).toBe("GET");
      expect(result.transaction).toBe("challenge_xdr");
    });

    it("encodes special characters in the public key", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ transaction: "xdr", networkPassphrase: "Test SDF Network ; September 2015" }),
      } as Response);

      await sdkModule.sdk.getChallenge("G+=");

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain("?account=G%2B%3D");
    });
  });

  describe("verifyChallenge", () => {
    it("calls POST /api/auth with the signed XDR in the body", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, token: "jwt_token", refreshToken: "refresh_token" }),
      } as Response);

      const result = await sdkModule.sdk.verifyChallenge("signed_xdr_here");

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toContain("/api/auth");
      expect(opts?.method).toBe("POST");
      expect(opts?.body).toBe(JSON.stringify({ transaction: "signed_xdr_here" }));
      expect(result.token).toBe("jwt_token");
    });
  });

  describe("initSdkAuth", () => {
    it("attaches the stored JWT token to the SDK instance", () => {
      (getJwtToken as jest.Mock).mockReturnValue("test_jwt");

      sdkModule.initSdkAuth();

      // After initSdkAuth, calling headers() with the token attached should include
      // the Authorization header. We verify by calling getChallenge which uses headers().
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ transaction: "xdr", networkPassphrase: "" }),
      } as Response);

      sdkModule.sdk.getChallenge("G123");

      const [, opts] = mockFetch.mock.calls[0];
      const headers = new Headers(opts?.headers);
      expect(headers.get("Authorization")).toBe("Bearer test_jwt");
    });

    it("does nothing when no token is available", () => {
      (getJwtToken as jest.Mock).mockReturnValue(null);

      sdkModule.initSdkAuth();

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ transaction: "xdr", networkPassphrase: "" }),
      } as Response);

      sdkModule.sdk.getChallenge("G123");

      const [, opts] = mockFetch.mock.calls[0];
      const headers = new Headers(opts?.headers);
      expect(headers.get("Authorization")).toBeNull();
    });
  });
});

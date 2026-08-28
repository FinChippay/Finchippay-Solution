import { FinchippayClient, ApiHttpError } from "@finchippay/sdk";
import { apiClient } from "@/lib/api";

describe("FinchippayClient SDK dogfooding", () => {
  let mockFetch: jest.Mock;

  beforeEach(() => {
    mockFetch = jest.fn();
  });

  it("exports a configured FinchippayClient instance", () => {
    expect(apiClient).toBeInstanceOf(FinchippayClient);
    expect(apiClient.accounts).toBeDefined();
    expect(apiClient.auth).toBeDefined();
    expect(apiClient.tips).toBeDefined();
    expect(apiClient.events).toBeDefined();
    expect(apiClient.sep12).toBeDefined();
    expect(apiClient.payments).toBeDefined();
    expect(apiClient.analytics).toBeDefined();
  });

  it("handles auth challenge and token verification", async () => {
    const mockChallenge = { transaction: "AAAA_XDR_CHALLENGE", networkPassphrase: "Test SDF Network" };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({ success: true, data: mockChallenge }),
    });

    const client = new FinchippayClient({
      baseUrl: "https://api.finchippay.test",
      fetch: mockFetch,
    });

    const challenge = await client.auth.getChallenge("GBZXN7PIRZGNMHGA72ST2EQTV6QGQUVJWOG2PTSAXBZ4P4GC65M52D3W");
    expect(challenge.transaction).toBe("AAAA_XDR_CHALLENGE");
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.finchippay.test/api/v1/auth?account=GBZXN7PIRZGNMHGA72ST2EQTV6QGQUVJWOG2PTSAXBZ4P4GC65M52D3W",
      expect.objectContaining({ method: "GET" })
    );

    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({
        success: true,
        data: { token: "jwt_token_123", accessToken: "jwt_token_123", refreshToken: "refresh_456" },
      }),
    });

    const tokenRes = await client.auth.verifyChallenge("SIGNED_XDR_789");
    expect(tokenRes.token).toBe("jwt_token_123");
    expect(client.getToken()).toBe("jwt_token_123");
  });

  it("resolves username via accounts namespace", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({
        success: true,
        data: { username: "alice", publicKey: "GBZXN7PIRZGNMHGA72ST2EQTV6QGQUVJWOG2PTSAXBZ4P4GC65M52D3W" },
      }),
    });

    const client = new FinchippayClient({
      baseUrl: "https://api.finchippay.test",
      fetch: mockFetch,
    });

    const res = await client.accounts.resolveUsername("alice");
    expect(res.data.username).toBe("alice");
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.finchippay.test/api/v1/accounts/resolve/alice",
      expect.objectContaining({ method: "GET" })
    );
  });

  it("records tips and fetches tip stats", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({ success: true }),
      })
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({
          success: true,
          data: { totalReceived: "100.5", totalTips: 5 },
        }),
      });

    const client = new FinchippayClient({
      baseUrl: "https://api.finchippay.test",
      fetch: mockFetch,
    });

    await client.tips.create({
      creatorPublicKey: "GCREATOR123",
      amount: "10.0",
      asset: "XLM",
    });

    const stats = await client.tips.getStats("GCREATOR123");
    expect((stats.data as any).totalReceived).toBe("100.5");
  });

  it("fetches event stats via events namespace", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({
        success: true,
        data: { totalEvents: 42 },
      }),
    });

    const client = new FinchippayClient({
      baseUrl: "https://api.finchippay.test",
      fetch: mockFetch,
    });

    const res = await client.events.getStats("GBZXN7PIRZGNMHGA72ST2EQTV6QGQUVJWOG2PTSAXBZ4P4GC65M52D3W");
    expect(res.data.totalEvents).toBe(42);
  });

  it("throws ApiHttpError on non-2xx responses", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      headers: new Headers({ "content-type": "application/json" }),
      text: async () => JSON.stringify({ error: "Account not found" }),
    });

    const client = new FinchippayClient({
      baseUrl: "https://api.finchippay.test",
      fetch: mockFetch,
    });

    await expect(client.accounts.resolveUsername("nonexistent")).rejects.toThrow(ApiHttpError);
  });
});

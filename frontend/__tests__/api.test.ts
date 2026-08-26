import { getSessionId } from "@/lib/correlation";

function extractHeaders(call: any): Headers {
  return new Headers(call[1]?.headers);
}

describe("patchGlobalFetch traceparent scoping", () => {
  const originalFetch = globalThis.fetch;
  const originalApiUrl = process.env.NEXT_PUBLIC_API_URL;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env.NEXT_PUBLIC_API_URL = originalApiUrl;
  });

  it("does NOT inject traceparent into third-party URLs that merely contain /api/", async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true } as Response);
    globalThis.fetch = fetchMock;

    jest.isolateModules(() => {
      require("@/lib/api");
    });

    await globalThis.fetch("https://api.coingecko.com/api/v3/simple/price?ids=btc", {
      method: "GET",
    });

    const headers = extractHeaders(fetchMock.mock.calls[0]);
    expect(headers.get("traceparent")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("injects traceparent for the configured first-party backend origin", async () => {
    process.env.NEXT_PUBLIC_API_URL = "https://api.finchippay.example.com";
    const fetchMock = jest.fn().mockResolvedValue({ ok: true } as Response);
    globalThis.fetch = fetchMock;

    jest.isolateModules(() => {
      require("@/lib/api");
    });

    await globalThis.fetch("https://api.finchippay.example.com/api/payments", {
      method: "GET",
    });

    const headers = extractHeaders(fetchMock.mock.calls[0]);
    expect(headers.get("traceparent")).toMatch(/^00-[a-f0-9]{32}-[a-f0-9]{16}-01$/);
    expect(headers.get("X-Session-ID")).toBe(getSessionId());
  });

  it("injects traceparent for relative (same-origin) API paths", async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true } as Response);
    globalThis.fetch = fetchMock;

    jest.isolateModules(() => {
      require("@/lib/api");
    });

    await globalThis.fetch("/api/health", { method: "GET" });

    const headers = extractHeaders(fetchMock.mock.calls[0]);
    expect(headers.get("traceparent")).toMatch(/^00-[a-f0-9]{32}-[a-f0-9]{16}-01$/);
  });

  it("does NOT inject traceparent into third-party hosts even when path has /api/", async () => {
    process.env.NEXT_PUBLIC_API_URL = "https://api.finchippay.example.com";
    const fetchMock = jest.fn().mockResolvedValue({ ok: true } as Response);
    globalThis.fetch = fetchMock;

    jest.isolateModules(() => {
      require("@/lib/api");
    });

    await globalThis.fetch("https://some-other-vendor.com/api/webhooks", {
      method: "POST",
      body: "{}",
    });

    const headers = extractHeaders(fetchMock.mock.calls[0]);
    expect(headers.get("traceparent")).toBeNull();
  });
});

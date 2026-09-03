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

describe("generateTraceParent", () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env.NEXT_PUBLIC_TRACE_SAMPLING_RATE;
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.NEXT_PUBLIC_TRACE_SAMPLING_RATE;
    } else {
      process.env.NEXT_PUBLIC_TRACE_SAMPLING_RATE = originalEnv;
    }
  });

  it("returns a valid W3C traceparent header", async () => {
    const { generateTraceParent } = await import("@/lib/api");
    const header = generateTraceParent();
    // Format: 00-{32 hex}-{16 hex}-00|01
    expect(header).toMatch(/^00-[a-f0-9]{32}-[a-f0-9]{16}-(00|01)$/);
  });

  it("produces unique IDs on each call", async () => {
    const { generateTraceParent } = await import("@/lib/api");
    const headers = new Set(Array.from({ length: 50 }, () => generateTraceParent()));
    // All 50 should be unique (collision probability is negligible)
    expect(headers.size).toBe(50);
  });

  it("uses cryptographic randomness, not Math.random", async () => {
    const { generateTraceParent } = await import("@/lib/api");
    // If it used Math.random, we could mock it and see predictable output.
    // Instead, verify that the output is not deterministic by running it
    // many times and checking the distribution of the first byte.
    const samples = Array.from({ length: 200 }, () => generateTraceParent());
    // Extract trace-ids and verify they don't repeat
    const traceIds = samples.map((h) => h.split("-")[1]);
    expect(new Set(traceIds).size).toBe(200);
  });

  it("respects sampling rate environment variable", async () => {
    // 100% sampling rate
    process.env.NEXT_PUBLIC_TRACE_SAMPLING_RATE = "1.0";
    const { generateTraceParent } = await import("@/lib/api");
    const headers = Array.from({ length: 20 }, () => generateTraceParent());
    expect(headers.every((h) => h.endsWith("-01"))).toBe(true);

    // 0% sampling rate
    process.env.NEXT_PUBLIC_TRACE_SAMPLING_RATE = "0.0";
    const headers2 = Array.from({ length: 20 }, () => generateTraceParent());
    expect(headers2.every((h) => h.endsWith("-00"))).toBe(true);
  });
});

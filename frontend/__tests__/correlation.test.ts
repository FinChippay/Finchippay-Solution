import { apiFetch } from "@/lib/api";
import { createActionId, getCorrelationId, getSessionId, withCorrelation } from "@/lib/correlation";

describe("correlation ID propagation", () => {
  it("adds a unique request ID and stable session ID to each request", async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true } as Response);
    const correlatedFetch = withCorrelation(fetchMock as typeof fetch);

    await correlatedFetch("/api/one");
    await correlatedFetch("/api/two");

    const first = new Headers(fetchMock.mock.calls[0][1].headers);
    const second = new Headers(fetchMock.mock.calls[1][1].headers);
    expect(first.get("X-Request-ID")).toBeTruthy();
    expect(second.get("X-Request-ID")).toBeTruthy();
    expect(first.get("X-Request-ID")).not.toBe(second.get("X-Request-ID"));
    expect(first.get("X-Session-ID")).toBe(getSessionId());
    expect(second.get("X-Session-ID")).toBe(getSessionId());
  });

  it("moves a caller-provided correlation ID to X-Retry-Of", async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true } as Response);
    await withCorrelation(fetchMock as typeof fetch)("/api/payments", {
      headers: { "X-Request-ID": "trace-from-ui-643" },
    });

    const headers = new Headers(fetchMock.mock.calls[0][1].headers);
    // The request ID is always fresh; the old value moves to X-Retry-Of.
    expect(headers.get("X-Request-ID")).toBeTruthy();
    expect(headers.get("X-Request-ID")).not.toBe("trace-from-ui-643");
    expect(headers.get("X-Retry-Of")).toBe("trace-from-ui-643");
  });

  it("two calls with the same init object produce different request IDs", async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true } as Response);
    const correlatedFetch = withCorrelation(fetchMock as typeof fetch);
    const init: RequestInit = { headers: { "X-Request-ID": "retried-id" } };

    await correlatedFetch("/api/pay", init);
    await correlatedFetch("/api/pay", init);

    const first = new Headers(fetchMock.mock.calls[0][1].headers);
    const second = new Headers(fetchMock.mock.calls[1][1].headers);
    // Each call gets a fresh request ID
    expect(first.get("X-Request-ID")).toBeTruthy();
    expect(second.get("X-Request-ID")).toBeTruthy();
    expect(first.get("X-Request-ID")).not.toBe(second.get("X-Request-ID"));
    // Both carry the original ID as X-Retry-Of
    expect(first.get("X-Retry-Of")).toBe("retried-id");
    expect(second.get("X-Retry-Of")).toBe("retried-id");
  });

  it("apiFetch sends correlation and W3C trace headers", async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true } as Response);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock;

    await apiFetch("/api/health");

    const headers = new Headers(fetchMock.mock.calls[0][1].headers);
    expect(headers.get("X-Request-ID")).toBeTruthy();
    expect(headers.get("X-Session-ID")).toBe(getSessionId());
    expect(headers.get("traceparent")).toMatch(/^00-[a-f0-9]{32}-[a-f0-9]{16}-01$/);
    globalThis.fetch = originalFetch;
  });

  it("tracks the most recent action for error capture", () => {
    const id = createActionId();
    expect(getCorrelationId()).toBe(id);
  });
});

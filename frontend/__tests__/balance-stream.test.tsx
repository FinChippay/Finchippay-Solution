/**
 * __tests__/balance-stream.test.tsx
 * Coverage for the SSE balance hook (#157): live updates, polling fallback,
 * exponential backoff, and pausing while the tab is hidden.
 */

import { act, render, screen } from "@testing-library/react";
import { useBalanceStream } from "@/lib/useBalanceStream";

const PUBLIC_KEY = "GA" + "A".repeat(54);

const getXLMBalance = jest.fn();
jest.mock("@/lib/stellar", () => ({
  getXLMBalance: (...args: unknown[]) => getXLMBalance(...args),
}));

jest.mock("@/lib/auth", () => ({
  ensureAccessToken: async () => "test-jwt-token",
}));

/** Minimal EventSource stand-in — jsdom does not implement one. */
class FakeEventSource {
  static instances: FakeEventSource[] = [];

  url: string;
  closed = false;
  onerror: (() => void) | null = null;
  private listeners = new Map<string, Array<(event: MessageEvent) => void>>();

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, handler: (event: MessageEvent) => void) {
    const existing = this.listeners.get(type) ?? [];
    existing.push(handler);
    this.listeners.set(type, existing);
  }

  close() {
    this.closed = true;
  }

  /** Deliver a named server event to the hook. */
  emit(type: string, data: unknown) {
    act(() => {
      for (const handler of this.listeners.get(type) ?? []) {
        handler({ data: JSON.stringify(data) } as MessageEvent);
      }
    });
  }

  /** Simulate a transport failure. The polling fallback it triggers is async,
   *  so callers await this to let those state updates land inside act(). */
  async fail() {
    await act(async () => {
      this.onerror?.();
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  static get latest() {
    return FakeEventSource.instances[FakeEventSource.instances.length - 1];
  }
}

function Probe({ publicKey }: { publicKey: string | null }) {
  const { xlmBalance, isLive, error, lastUpdatedAt } = useBalanceStream(publicKey);
  return (
    <div>
      <span data-testid="balance">{xlmBalance}</span>
      <span data-testid="live">{String(isLive)}</span>
      <span data-testid="error">{error ?? "none"}</span>
      <span data-testid="seen">{lastUpdatedAt === null ? "no" : "yes"}</span>
    </div>
  );
}

let hidden = false;

beforeAll(() => {
  Object.defineProperty(document, "hidden", { get: () => hidden, configurable: true });
});

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  hidden = false;
  FakeEventSource.instances = [];
  (global as unknown as { EventSource: unknown }).EventSource = FakeEventSource;
  getXLMBalance.mockResolvedValue("50.0000000");
});

afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

/** Let pending promises (token lookup, poll) settle inside act(). */
async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** Mount the probe and wait for the async connect() to settle. */
async function mount(publicKey: string | null) {
  let result!: ReturnType<typeof render>;
  await act(async () => {
    result = render(<Probe publicKey={publicKey} />);
  });
  await flush();
  return result;
}

async function setHidden(value: boolean) {
  hidden = value;
  await act(async () => {
    document.dispatchEvent(new Event("visibilitychange"));
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("useBalanceStream", () => {
  it("does not connect without a public key", async () => {
    await mount(null);

    expect(FakeEventSource.instances).toHaveLength(0);
    expect(screen.getByTestId("balance")).toHaveTextContent("0");
    expect(screen.getByTestId("seen")).toHaveTextContent("no");
  });

  it("opens an authenticated stream for the account", async () => {
    await mount(PUBLIC_KEY);

    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.latest.url).toContain(`/api/accounts/${PUBLIC_KEY}/stream`);
    // EventSource cannot set headers, so the JWT rides in the query string.
    expect(FakeEventSource.latest.url).toContain("token=test-jwt-token");
    expect(getXLMBalance).not.toHaveBeenCalled();
  });

  it("renders balances pushed over the stream", async () => {
    await mount(PUBLIC_KEY);

    FakeEventSource.latest.emit("balance", { xlm: "123.4567890" });

    expect(screen.getByTestId("balance")).toHaveTextContent("123.4567890");
    expect(screen.getByTestId("live")).toHaveTextContent("true");
    expect(screen.getByTestId("seen")).toHaveTextContent("yes");
  });

  it("surfaces a server-reported stream-error without dropping the connection", async () => {
    await mount(PUBLIC_KEY);

    FakeEventSource.latest.emit("stream-error", { message: "Horizon interrupted." });

    expect(screen.getByTestId("error")).toHaveTextContent("Horizon interrupted.");
    expect(FakeEventSource.latest.closed).toBe(false);
  });

  it("falls back to polling when the connection fails", async () => {
    await mount(PUBLIC_KEY);
    const source = FakeEventSource.latest;

    await source.fail();

    expect(source.closed).toBe(true);
    expect(screen.getByTestId("live")).toHaveTextContent("false");
    await flush();
    expect(getXLMBalance).toHaveBeenCalledWith(PUBLIC_KEY);

    await act(async () => {
      jest.advanceTimersByTime(30_000);
    });
    await flush();
    expect(getXLMBalance).toHaveBeenCalledTimes(2);
  });

  it("reconnects with exponential backoff capped at 30s", async () => {
    await mount(PUBLIC_KEY);

    const delays = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000];

    for (let index = 0; index < delays.length; index += 1) {
      const delay = delays[index];
      await FakeEventSource.latest.fail();

      // Nothing reconnects one tick before the backoff elapses. The longer
      // waits also cross a 30s poll tick, so these advances are awaited.
      await act(async () => {
        jest.advanceTimersByTime(delay - 1);
      });
      expect(FakeEventSource.instances).toHaveLength(index + 1);

      await act(async () => {
        jest.advanceTimersByTime(1);
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(FakeEventSource.instances).toHaveLength(index + 2);
    }
  });

  it("resets the backoff once a balance arrives again", async () => {
    await mount(PUBLIC_KEY);

    await FakeEventSource.latest.fail();
    await act(async () => {
      jest.advanceTimersByTime(1_000);
      await Promise.resolve();
      await Promise.resolve();
    });
    await FakeEventSource.latest.fail();
    await act(async () => {
      jest.advanceTimersByTime(2_000);
      await Promise.resolve();
      await Promise.resolve();
    });

    FakeEventSource.latest.emit("balance", { xlm: "9.0000000" });

    await FakeEventSource.latest.fail();
    const count = FakeEventSource.instances.length;
    await act(async () => {
      jest.advanceTimersByTime(1_000);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(FakeEventSource.instances).toHaveLength(count + 1);
  });

  it("stops polling once the stream recovers", async () => {
    await mount(PUBLIC_KEY);

    await FakeEventSource.latest.fail();
    await flush();
    expect(getXLMBalance).toHaveBeenCalledTimes(1);

    await act(async () => {
      jest.advanceTimersByTime(1_000);
      await Promise.resolve();
      await Promise.resolve();
    });
    FakeEventSource.latest.emit("balance", { xlm: "11.0000000" });

    await act(async () => {
      jest.advanceTimersByTime(60_000);
    });
    await flush();
    expect(getXLMBalance).toHaveBeenCalledTimes(1);
  });

  it("pauses the stream while the tab is hidden and resumes when shown", async () => {
    await mount(PUBLIC_KEY);
    const source = FakeEventSource.latest;

    await setHidden(true);
    expect(source.closed).toBe(true);
    expect(FakeEventSource.instances).toHaveLength(1);

    await setHidden(false);
    expect(FakeEventSource.instances).toHaveLength(2);
    expect(FakeEventSource.latest.closed).toBe(false);
  });

  it("does not open a stream when mounted in a hidden tab", async () => {
    hidden = true;
    await mount(PUBLIC_KEY);

    expect(FakeEventSource.instances).toHaveLength(0);

    await setHidden(false);
    expect(FakeEventSource.instances).toHaveLength(1);
  });

  it("polls when the browser has no EventSource support", async () => {
    delete (global as unknown as { EventSource?: unknown }).EventSource;

    // Polling starts during the mount effect, so the first fetch resolves while
    // React is still committing — mount inside act() to absorb it.
    await act(async () => {
      await mount(PUBLIC_KEY);
    });
    await flush();
    expect(getXLMBalance).toHaveBeenCalledWith(PUBLIC_KEY);
    expect(screen.getByTestId("balance")).toHaveTextContent("50.0000000");
    expect(screen.getByTestId("live")).toHaveTextContent("false");
  });

  it("closes the stream on unmount", async () => {
    const { unmount } = await mount(PUBLIC_KEY);
    const source = FakeEventSource.latest;

    unmount();

    expect(source.closed).toBe(true);
  });

  it("reopens the stream when the active account changes", async () => {
    const other = "GB" + "B".repeat(54);
    const { rerender } = await mount(PUBLIC_KEY);
    const first = FakeEventSource.latest;

    await act(async () => {
      rerender(<Probe publicKey={other} />);
    });
    await flush();

    expect(first.closed).toBe(true);
    expect(FakeEventSource.latest.url).toContain(other);
  });
});

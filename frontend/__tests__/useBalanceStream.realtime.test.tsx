/**
 * __tests__/useBalanceStream.realtime.test.tsx
 * Round-trip coverage for #641: reconnect+reconcile, optimistic updates,
 * live/reconnecting/stale indicator, and no-duplicate/no-drop guarantees.
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

const mockTicket = { ticket: "mock-ticket-value" };
jest.mock("@/lib/api", () => ({
  apiFetch: jest.fn().mockResolvedValue({
    ok: true,
    json: async () => mockTicket,
  }),
}));

/** EventSource stand-in with transport-lifetime tracking (open/error). */
class FakeEventSource {
  static instances: FakeEventSource[] = [];

  url: string;
  closed = false;
  onerror: (() => void) | null = null;
  onopen: (() => void) | null = null;
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

  emit(type: string, data: unknown) {
    act(() => {
      for (const handler of this.listeners.get(type) ?? []) {
        handler({ data: JSON.stringify(data) } as MessageEvent);
      }
    });
  }

  /** Signal the transport went up (what the browser does after connecting). */
  open() {
    act(() => {
      this.onopen?.();
    });
  }

  /** Simulate a transport failure. */
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
  const {
    xlmBalance,
    isLive,
    connectionState,
    error,
    hasOptimisticUpdate,
    applyOptimisticBalance,
    rollbackOptimistic,
  } = useBalanceStream(publicKey);
  return (
    <div>
      <span data-testid="balance">{xlmBalance}</span>
      <span data-testid="live">{String(isLive)}</span>
      <span data-testid="state">{connectionState}</span>
      <span data-testid="error">{error ?? "none"}</span>
      <span data-testid="optimistic">{String(hasOptimisticUpdate)}</span>
      <button data-testid="apply" onClick={() => applyOptimisticBalance("40.0000000")}>
        apply
      </button>
      <button data-testid="custom-apply" onClick={() => applyOptimisticBalance("7.5000000")}>
        custom
      </button>
      <button data-testid="rollback" onClick={() => rollbackOptimistic()}>
        rollback
      </button>
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

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function mount(publicKey: string | null) {
  let result!: ReturnType<typeof render>;
  await act(async () => {
    result = render(<Probe publicKey={publicKey} />);
  });
  await flush();
  return result;
}

/** Click an optimistic-update button inside act and flush. */
async function clickWithFlush(testId: string) {
  await act(async () => {
    screen.getByTestId(testId).click();
  });
  await flush();
}

/** Simulate a full outage and successful reconnect. */
async function simulateOutageAndReconnect() {
  await FakeEventSource.latest.fail();
  const connectionCount = FakeEventSource.instances.length;
  await act(async () => {
    jest.advanceTimersByTime(1_000); // backoff 1s
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(FakeEventSource.instances).toHaveLength(connectionCount + 1);
  FakeEventSource.latest.open();
  // Let the reconcile (and any rejection it raises) settle inside act().
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
  return FakeEventSource.latest;
}

describe("useBalanceStream #641 — reconnect & reconcile", () => {
  it("exposes a stale connection state before any stream activity", async () => {
    await mount(PUBLIC_KEY);
    expect(screen.getByTestId("state")).toHaveTextContent("stale");
  });

  it("flips to live when a balance arrives over SSE", async () => {
    await mount(PUBLIC_KEY);
    expect(screen.getByTestId("state")).toHaveTextContent("stale");

    FakeEventSource.latest.emit("balance", { xlm: "123.0000000" });

    expect(screen.getByTestId("state")).toHaveTextContent("live");
    expect(screen.getByTestId("live")).toHaveTextContent("true");
  });

  it("marks the connection as reconnecting after a transport failure", async () => {
    await mount(PUBLIC_KEY);
    await FakeEventSource.latest.fail();

    expect(screen.getByTestId("state")).toHaveTextContent("reconnecting");
    expect(screen.getByTestId("live")).toHaveTextContent("false");
  });

  it("reconciles the authoritative balance on a successful reconnect", async () => {
    // The balance moved to 44 while the stream was down.
    getXLMBalance.mockResolvedValue("44.0000000");
    await mount(PUBLIC_KEY);
    FakeEventSource.latest.emit("balance", { xlm: "50.0000000" });

    await simulateOutageAndReconnect();

    // Reconcile() fetched the authoritative value, overriding the stale one
    // that the pre-outage SSE event delivered.
    expect(getXLMBalance).toHaveBeenCalledWith(PUBLIC_KEY);
    await flush();
    expect(screen.getByTestId("balance")).toHaveTextContent("44.0000000");
  });

  it("keeps a stale poll from regressing a value already reconciled", async () => {
    // The poll started during the outage resolves LATE — after the reconnect's
    // reconcile has already applied the authoritative value. The late poll
    // must be dropped, not regress the balance back to its older snapshot.
    let resolveLatePoll!: (value: string) => void;
    const latePoll = new Promise<string>((resolve) => {
      resolveLatePoll = resolve;
    });
    getXLMBalance
      .mockReturnValueOnce(latePoll) // poll started during outage (late)
      .mockResolvedValueOnce("56.0000000"); // reconcile after reconnect

    await mount(PUBLIC_KEY);
    FakeEventSource.latest.emit("balance", { xlm: "50.0000000" });

    // Transport failure: poll fires immediately and hangs awaiting Horizon.
    await FakeEventSource.latest.fail();
    const connectionCount = FakeEventSource.instances.length;

    // Backoff elapses → new stream opens → reconcile applies 56.
    await act(async () => {
      jest.advanceTimersByTime(1_000);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(FakeEventSource.instances).toHaveLength(connectionCount + 1);
    FakeEventSource.latest.open();
    await flush();
    expect(screen.getByTestId("balance")).toHaveTextContent("56.0000000");

    // The stale poll finally lands with the OLD value — it must not win.
    await act(async () => {
      resolveLatePoll("54.0000000");
      await Promise.resolve();
      await Promise.resolve();
    });
    await flush();
    expect(screen.getByTestId("balance")).toHaveTextContent("56.0000000");
    expect(screen.getByTestId("state")).toHaveTextContent("live");
  });

  it("does not regress live-ness when the restored stream stays up", async () => {
    await mount(PUBLIC_KEY);
    FakeEventSource.latest.emit("balance", { xlm: "50.0000000" });

    const restored = await simulateOutageAndReconnect();
    restored.emit("balance", { xlm: "52.0000000" });

    expect(screen.getByTestId("state")).toHaveTextContent("live");
    expect(screen.getByTestId("balance")).toHaveTextContent("52.0000000");
  });
});

describe("useBalanceStream #641 — optimistic updates", () => {
  it("shows an optimistic balance immediately and flags it as unconfirmed", async () => {
    await mount(PUBLIC_KEY);
    FakeEventSource.latest.emit("balance", { xlm: "50.0000000" });

    await clickWithFlush("apply");

    expect(screen.getByTestId("balance")).toHaveTextContent("40.0000000");
    expect(screen.getByTestId("optimistic")).toHaveTextContent("true");
  });

  it("rolls back a failed optimistic update to the authoritative value", async () => {
    await mount(PUBLIC_KEY);
    FakeEventSource.latest.emit("balance", { xlm: "50.0000000" });

    await clickWithFlush("apply");
    expect(screen.getByTestId("balance")).toHaveTextContent("40.0000000");

    await clickWithFlush("rollback");

    expect(screen.getByTestId("balance")).toHaveTextContent("50.0000000");
    expect(screen.getByTestId("optimistic")).toHaveTextContent("false");
  });

  it("lets an authoritative SSE balance override a stale optimistic value", async () => {
    await mount(PUBLIC_KEY);
    FakeEventSource.latest.emit("balance", { xlm: "50.0000000" });

    await clickWithFlush("apply");
    expect(screen.getByTestId("balance")).toHaveTextContent("40.0000000");

    // The server confirms the real (lower) balance.
    FakeEventSource.latest.emit("balance", { xlm: "38.0000000" });

    expect(screen.getByTestId("balance")).toHaveTextContent("38.0000000");
    expect(screen.getByTestId("optimistic")).toHaveTextContent("false");
  });

  it("rolls back to the latest authoritative value after a reconcile", async () => {
    getXLMBalance.mockResolvedValue("36.0000000");
    await mount(PUBLIC_KEY);
    FakeEventSource.latest.emit("balance", { xlm: "50.0000000" });

    // Optimistic value shown, then the stream drops.
    await clickWithFlush("custom-apply");
    expect(screen.getByTestId("balance")).toHaveTextContent("7.5000000");

    await simulateOutageAndReconnect();
    await flush();

    // Reconcile fetched 36.0000000 → optimistic overlay dropped, authoritative shown.
    expect(screen.getByTestId("balance")).toHaveTextContent("36.0000000");
    expect(screen.getByTestId("optimistic")).toHaveTextContent("false");
  });
});

describe("useBalanceStream #641 — no duplicated or dropped updates", () => {
  it("does not duplicate or drop updates across a simulated disconnect", async () => {
    getXLMBalance.mockResolvedValue("63.0000000"); // authoritative during outage
    await mount(PUBLIC_KEY);

    // Pre-outage balance.
    FakeEventSource.latest.emit("balance", { xlm: "60.0000000" });
    expect(screen.getByTestId("balance")).toHaveTextContent("60.0000000");

    // Drop: two payments land server-side while we are disconnected.
    await FakeEventSource.latest.fail();
    expect(screen.getByTestId("state")).toHaveTextContent("reconnecting");

    // Reconnect with backoff → reconcile picks up exactly one final value.
    const connectionCount = FakeEventSource.instances.length;
    await act(async () => {
      jest.advanceTimersByTime(1_000);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(FakeEventSource.instances).toHaveLength(connectionCount + 1);
    FakeEventSource.latest.open();
    await flush();

    expect(screen.getByTestId("balance")).toHaveTextContent("63.0000000");
    // Single span, single rendered value — no duplicates in the DOM.
    expect(screen.getAllByTestId("balance")).toHaveLength(1);
  });

  it("holds the last value while reconnecting instead of zeroing it", async () => {
    // Poll hangs during the outage so the existing balance stays on screen.
    let resolveHeldPoll!: (value: string) => void;
    const heldPoll = new Promise<string>((resolve) => {
      resolveHeldPoll = resolve;
    });
    getXLMBalance.mockReturnValueOnce(heldPoll);

    await mount(PUBLIC_KEY);
    FakeEventSource.latest.emit("balance", { xlm: "70.0000000" });

    await FakeEventSource.latest.fail();

    // While reconnecting the last good value stays on screen — the poll
    // hasn't returned yet so there is no authoritative replacement.
    expect(screen.getByTestId("state")).toHaveTextContent("reconnecting");
    expect(screen.getByTestId("balance")).toHaveTextContent("70.0000000");

    // Poll eventually resolves — still the same value, no regression.
    await act(async () => {
      resolveHeldPoll("70.0000000");
      await Promise.resolve();
      await Promise.resolve();
    });
    await flush();
    expect(screen.getByTestId("balance")).toHaveTextContent("70.0000000");
  });

  it("flags a reconciliation failure without wiping the displayed balance", async () => {
    getXLMBalance.mockRejectedValue(new Error("Horizon timeout"));
    await mount(PUBLIC_KEY);
    FakeEventSource.latest.emit("balance", { xlm: "70.0000000" });

    await simulateOutageAndReconnect();
    await flush();

    expect(screen.getByTestId("error")).toHaveTextContent("Horizon timeout");
    expect(screen.getByTestId("balance")).toHaveTextContent("70.0000000");
  });
});
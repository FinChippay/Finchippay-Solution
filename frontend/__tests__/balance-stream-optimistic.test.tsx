/**
 * __tests__/balance-stream-optimistic.test.tsx
 * Coverage for optimistic updates, rollback, reconciliation, and the
 * live / reconnecting / stale / polling status machine (#641).
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

  emit(type: string, data: unknown) {
    act(() => {
      for (const handler of this.listeners.get(type) ?? []) {
        handler({ data: JSON.stringify(data) } as MessageEvent);
      }
    });
  }

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
  const stream = useBalanceStream(publicKey);
  const {
    xlmBalance,
    confirmedXlmBalance,
    status,
    error,
    isOptimistic,
    applyOptimisticDelta,
    rollbackOptimistic,
    reconcile,
  } = stream;
  return (
    <div>
      <span data-testid="balance">{xlmBalance}</span>
      <span data-testid="confirmed">{confirmedXlmBalance}</span>
      <span data-testid="status">{status}</span>
      <span data-testid="error">{error ?? "none"}</span>
      <span data-testid="optimistic">{String(isOptimistic)}</span>
      <button data-testid="apply-send" onClick={() => applyOptimisticDelta("-10.0000000", "send:1")}>
        send
      </button>
      <button data-testid="apply-claim" onClick={() => applyOptimisticDelta("5.0000000", "claim:1")}>
        claim
      </button>
      <button data-testid="rollback" onClick={() => rollbackOptimistic("send:1")}>
        rollback
      </button>
      <button data-testid="reconcile" onClick={() => void reconcile()}>
        reconcile
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

async function mount() {
  let result!: ReturnType<typeof render>;
  await act(async () => {
    result = render(<Probe publicKey={PUBLIC_KEY} />);
  });
  await flush();
  return result;
}

async function click(testId: string) {
  await act(async () => {
    screen.getByTestId(testId).click();
    await Promise.resolve();
  });
}

describe("useBalanceStream optimistic updates (#641)", () => {
  it("applies an optimistic send delta on top of the confirmed balance", async () => {
    await mount();
    FakeEventSource.latest.emit("balance", { xlm: "100.0000000" });
    expect(screen.getByTestId("balance")).toHaveTextContent("100.0000000");

    await click("apply-send");

    expect(screen.getByTestId("optimistic")).toHaveTextContent("true");
    // 100 - 10 = 90, display reflects the optimistic value immediately while
    // the confirmed balance stays at the authoritative 100.
    expect(screen.getByTestId("balance")).toHaveTextContent("90.0000000");
    expect(screen.getByTestId("confirmed")).toHaveTextContent("100.0000000");
  });

  it("rolls back an optimistic delta and restores the confirmed balance", async () => {
    await mount();
    FakeEventSource.latest.emit("balance", { xlm: "100.0000000" });

    await click("apply-send");
    expect(screen.getByTestId("balance")).toHaveTextContent("90.0000000");

    await click("rollback");

    expect(screen.getByTestId("optimistic")).toHaveTextContent("false");
    expect(screen.getByTestId("balance")).toHaveTextContent("100.0000000");
  });

  it("accumulates independent optimistic deltas and removes only the rolled-back key", async () => {
    await mount();
    FakeEventSource.latest.emit("balance", { xlm: "100.0000000" });

    await click("apply-send"); // -10 → 90
    await click("apply-claim"); // +5 → 95
    expect(screen.getByTestId("balance")).toHaveTextContent("95.0000000");

    await click("rollback"); // rollback send:1 → 95 + 10 = 105
    expect(screen.getByTestId("balance")).toHaveTextContent("105.0000000");
  });

  it("drops optimistic deltas when a stream balance arrives (server wins)", async () => {
    await mount();
    FakeEventSource.latest.emit("balance", { xlm: "100.0000000" });

    await click("apply-send");
    expect(screen.getByTestId("balance")).toHaveTextContent("90.0000000");

    // The on-chain send lands and the stream pushes the authoritative value.
    FakeEventSource.latest.emit("balance", { xlm: "90.0000000" });

    expect(screen.getByTestId("optimistic")).toHaveTextContent("false");
    expect(screen.getByTestId("balance")).toHaveTextContent("90.0000000");
    expect(screen.getByTestId("confirmed")).toHaveTextContent("90.0000000");
  });

  it("status is live while the stream delivers balances", async () => {
    await mount();
    expect(screen.getByTestId("status")).toHaveTextContent("polling");

    FakeEventSource.latest.emit("balance", { xlm: "1.0000000" });
    expect(screen.getByTestId("status")).toHaveTextContent("live");
  });

  it("status becomes reconnecting after a transport failure", async () => {
    await mount();
    FakeEventSource.latest.emit("balance", { xlm: "1.0000000" });
    expect(screen.getByTestId("status")).toHaveTextContent("live");

    await FakeEventSource.latest.fail();

    expect(screen.getByTestId("status")).toHaveTextContent("reconnecting");
  });

  it("status becomes stale after no confirmed balance for a long time", async () => {
    await mount();
    FakeEventSource.latest.emit("balance", { xlm: "1.0000000" });
    expect(screen.getByTestId("status")).toHaveTextContent("live");

    await FakeEventSource.latest.fail();
    expect(screen.getByTestId("status")).toHaveTextContent("reconnecting");

    // Transport is down and polling also fails → no confirmed balance inside
    // STALE_AFTER_MS (90s). The stale timer fires every 22.5s.
    getXLMBalance.mockRejectedValue(new Error("network down"));
    for (let i = 0; i < 7; i += 1) {
      await act(async () => {
        jest.advanceTimersByTime(15_000);
        await Promise.resolve();
      });
    }

    expect(screen.getByTestId("status")).toHaveTextContent("stale");
  });

  it("reconcile fetches the authoritative balance and clears optimistic deltas", async () => {
    await mount();
    FakeEventSource.latest.emit("balance", { xlm: "100.0000000" });

    await click("apply-send");
    expect(screen.getByTestId("balance")).toHaveTextContent("90.0000000");

    // Server says 77 — the optimistic -10 was wrong, reconcile must correct it.
    getXLMBalance.mockResolvedValueOnce("77.0000000");
    await click("reconcile");

    expect(screen.getByTestId("optimistic")).toHaveTextContent("false");
    expect(screen.getByTestId("confirmed")).toHaveTextContent("77.0000000");
    expect(screen.getByTestId("balance")).toHaveTextContent("77.0000000");
  });

  it("keeps the confirmed value updated by polls while optimistic deltas stay pending", async () => {
    await mount();
    FakeEventSource.latest.emit("balance", { xlm: "100.0000000" });
    await click("apply-send");
    expect(screen.getByTestId("confirmed")).toHaveTextContent("100.0000000");

    // Transport drops → polling takes over; the poll confirms a new
    // authoritative number (e.g. an incoming payment) of 120.
    getXLMBalance.mockResolvedValue("120.0000000");
    await FakeEventSource.latest.fail();

    await act(async () => {
      jest.advanceTimersByTime(30_000);
      await Promise.resolve();
    });

    expect(screen.getByTestId("confirmed")).toHaveTextContent("120.0000000");
    // 120 - 10 (still pending optimistic send) = 110 display
    expect(screen.getByTestId("balance")).toHaveTextContent("110.0000000");
  });
});
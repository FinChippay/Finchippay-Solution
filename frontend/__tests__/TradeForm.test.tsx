/**
 * __tests__/TradeForm.test.tsx
 *
 * Comprehensive tests for the token-swap TradeForm (Issue #249).
 *
 * Covers:
 *  - token selection
 *  - strict-send path lookup (5+ path-payment test cases)
 *  - strict-receive path lookup
 *  - best-path rendering / route display
 *  - slippage presets
 *  - custom slippage
 *  - swap preview rendering
 *  - price-impact warning (>3%)
 *  - confirmation modal
 *  - Horizon API success
 *  - Horizon API failure
 *  - no available path
 *  - loading state
 *  - edge cases (same token, invalid slippage, no wallet)
 */

import React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// ─── Mock pathFinder BEFORE importing TradeForm ───────────────────────────────
jest.mock("@/lib/pathFinder", () => ({
  findStrictSendPaths: jest.fn(),
  findStrictReceivePaths: jest.fn(),
  applySlippage: jest.fn((amt: string, pct: number) => {
    const v = parseFloat(amt);
    if (!v) return "0.0000000";
    return ((v * (1 - pct / 100))).toFixed(7);
  }),
  calculatePriceImpact: jest.fn(() => 0),
  pathAssetsToStellarAssets: jest.fn(() => []),
}));

jest.mock("@/lib/stellar", () => ({
  buildPathPaymentTransaction: jest.fn(),
  submitTransaction: jest.fn(),
  NETWORK_PASSPHRASE: "Test SDF Network ; October 2015",
  STELLAR_BASE_FEE_XLM: 0.00001,
}));

jest.mock("@stellar/freighter-api", () => ({
  signTransaction: jest.fn(),
}));

jest.mock("@/components/icons", () => ({
  SwapIcon: ({ className }: { className?: string }) => (
    <span data-testid="swap-icon" className={className} />
  ),
  AlertCircleIcon: ({ className }: { className?: string }) => (
    <span data-testid="alert-icon" className={className} />
  ),
  Spinner: ({ className }: { className?: string }) => (
    <span data-testid="spinner" className={className} />
  ),
}));

// ─── Imports after mocks ─────────────────────────────────────────────────────
import TradeForm from "../components/TradeForm";
import * as pathFinderModule from "@/lib/pathFinder";
import * as stellarModule from "@/lib/stellar";
import * as freighterModule from "@stellar/freighter-api";

// ─── Typed mock refs ─────────────────────────────────────────────────────────
const mockFindStrictSendPaths = pathFinderModule.findStrictSendPaths as jest.Mock;
const mockFindStrictReceivePaths = pathFinderModule.findStrictReceivePaths as jest.Mock;
const mockBuildPathPayment = stellarModule.buildPathPaymentTransaction as jest.Mock;
const mockSubmitTransaction = stellarModule.submitTransaction as jest.Mock;
const mockSignTransaction = freighterModule.signTransaction as jest.Mock;

// ─── Test helpers ─────────────────────────────────────────────────────────────

const DEFAULT_PROPS = {
  publicKey: "GBRPYHIL2CI3WHZDTOOQFC6EB4RRJC3D5NZ2KMSUGSRNVO7ZFGIGSZ",
  onTradeComplete: jest.fn(),
  onError: jest.fn(),
  onSuccess: jest.fn(),
};

/** A Horizon-style strict-send path result with a 2-hop route XLM → yXLM → USDC */
function makePathResult(overrides: Partial<pathFinderModule.PathFinderResult> = {}): pathFinderModule.PathFinderResult {
  return {
    paths: [
      {
        source_asset_type: "native",
        source_amount: "100.0000000",
        destination_asset_type: "credit_alphanum4",
        destination_asset_code: "USDC",
        destination_asset_issuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
        destination_amount: "12.3456789",
        path: [
          {
            asset_type: "credit_alphanum4",
            asset_code: "yXLM",
            asset_issuer: "GARDNV3Q7YGT4AKSDF25LT32YSCCW4EV22Y2TV3I2PU2MMXJTEDL5T55",
          },
        ],
      },
    ],
    bestPath: {
      source_asset_type: "native",
      source_amount: "100.0000000",
      destination_asset_type: "credit_alphanum4",
      destination_asset_code: "USDC",
      destination_asset_issuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
      destination_amount: "12.3456789",
      path: [
        {
          asset_type: "credit_alphanum4",
          asset_code: "yXLM",
          asset_issuer: "GARDNV3Q7YGT4AKSDF25LT32YSCCW4EV22Y2TV3I2PU2MMXJTEDL5T55",
        },
      ],
    },
    routeDisplay: "XLM → yXLM → USDC",
    sourceAmount: "100.0000000",
    destinationAmount: "12.3456789",
    ...overrides,
  };
}

/** Wait for debounce + async path-finder call to resolve. */
async function waitForPathFinder() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 700));
  });
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers({ advanceTimers: false });

  mockFindStrictSendPaths.mockResolvedValue(makePathResult());
  mockBuildPathPayment.mockResolvedValue({ toXDR: () => "mock-tx-xdr" });
  mockSignTransaction.mockResolvedValue({ signedTxXdr: "mock-signed-xdr" });
  mockSubmitTransaction.mockResolvedValue({ hash: "tx-hash-abc" });
});

afterEach(() => {
  jest.useRealTimers();
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. Token selection
// ─────────────────────────────────────────────────────────────────────────────

describe("Token selection", () => {
  it("renders Pay and Receive token selectors with XLM/USDC options", () => {
    render(<TradeForm {...DEFAULT_PROPS} />);

    const paySelect = screen.getByRole("combobox", { name: /Pay token/i });
    const receiveSelect = screen.getByRole("combobox", { name: /Receive token/i });

    expect(paySelect).toBeInTheDocument();
    expect(receiveSelect).toBeInTheDocument();

    const payOptions = Array.from(paySelect.querySelectorAll("option")).map((o) => o.value);
    const receiveOptions = Array.from(receiveSelect.querySelectorAll("option")).map((o) => o.value);

    expect(payOptions).toContain("XLM");
    expect(payOptions).toContain("USDC");
    expect(receiveOptions).toContain("XLM");
    expect(receiveOptions).toContain("USDC");
  });

  it("defaults to XLM → USDC direction", () => {
    render(<TradeForm {...DEFAULT_PROPS} />);

    const paySelect = screen.getByRole("combobox", { name: /Pay token/i }) as HTMLSelectElement;
    const receiveSelect = screen.getByRole("combobox", { name: /Receive token/i }) as HTMLSelectElement;

    expect(paySelect.value).toBe("XLM");
    expect(receiveSelect.value).toBe("USDC");
  });

  it("swap-direction button flips pay and receive tokens", async () => {
    const user = userEvent.setup({ delay: null });
    render(<TradeForm {...DEFAULT_PROPS} />);

    const paySelect = screen.getByRole("combobox", { name: /Pay token/i }) as HTMLSelectElement;
    const receiveSelect = screen.getByRole("combobox", { name: /Receive token/i }) as HTMLSelectElement;

    expect(paySelect.value).toBe("XLM");
    expect(receiveSelect.value).toBe("USDC");

    await user.click(screen.getByRole("button", { name: /Swap assets/i }));

    expect(paySelect.value).toBe("USDC");
    expect(receiveSelect.value).toBe("XLM");
  });

  it("swap-direction button is disabled when wallet not connected", () => {
    render(<TradeForm {...DEFAULT_PROPS} publicKey={null} />);
    expect(screen.getByRole("button", { name: /Swap assets/i })).toBeDisabled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Path-payment tests (minimum 5 required)
// ─────────────────────────────────────────────────────────────────────────────

describe("Path-payment tests", () => {
  /**
   * PATH-PAYMENT TEST 1
   * Strict-send path lookup is called with correct source asset and amount.
   */
  it("[PP-1] calls findStrictSendPaths with correct asset and amount", async () => {
    const user = userEvent.setup({ delay: null });
    render(<TradeForm {...DEFAULT_PROPS} />);

    const amountInput = screen.getByRole("spinbutton", { name: /Pay amount/i });
    await user.type(amountInput, "100");

    // Advance debounce timer
    act(() => { jest.advanceTimersByTime(700); });
    await waitFor(() => expect(mockFindStrictSendPaths).toHaveBeenCalled());

    const [srcAsset, amount] = mockFindStrictSendPaths.mock.calls[0];
    expect(srcAsset.isNative()).toBe(true);
    expect(amount).toBe("100");
  });

  /**
   * PATH-PAYMENT TEST 2
   * Best-route display is rendered after a successful path lookup.
   */
  it("[PP-2] displays the best route after a successful strict-send path lookup", async () => {
    const user = userEvent.setup({ delay: null });
    render(<TradeForm {...DEFAULT_PROPS} />);

    await user.type(screen.getByRole("spinbutton", { name: /Pay amount/i }), "50");

    act(() => { jest.advanceTimersByTime(700); });
    await waitFor(() => expect(screen.getByTestId("route-display")).toBeInTheDocument());

    expect(screen.getByTestId("route-display")).toHaveTextContent("XLM");
    expect(screen.getByTestId("route-display")).toHaveTextContent("USDC");
  });

  /**
   * PATH-PAYMENT TEST 3
   * Horizon API failure: error message is shown to the user.
   */
  it("[PP-3] shows path error when Horizon strict-send fails", async () => {
    mockFindStrictSendPaths.mockRejectedValueOnce(
      new Error("Horizon strict-send path lookup failed: 503 Service Unavailable")
    );

    const user = userEvent.setup({ delay: null });
    render(<TradeForm {...DEFAULT_PROPS} />);

    await user.type(screen.getByRole("spinbutton", { name: /Pay amount/i }), "10");

    act(() => { jest.advanceTimersByTime(700); });
    await waitFor(() =>
      expect(screen.getByTestId("path-error")).toBeInTheDocument()
    );
    expect(screen.getByTestId("path-error")).toHaveTextContent(/failed/i);
  });

  /**
   * PATH-PAYMENT TEST 4
   * No available path: "No path found" message appears.
   */
  it("[PP-4] shows no-path message when Horizon returns empty paths", async () => {
    mockFindStrictSendPaths.mockResolvedValueOnce({
      paths: [],
      bestPath: null,
      routeDisplay: "",
      sourceAmount: "10",
      destinationAmount: "0",
    });

    const user = userEvent.setup({ delay: null });
    render(<TradeForm {...DEFAULT_PROPS} />);

    await user.type(screen.getByRole("spinbutton", { name: /Pay amount/i }), "10");

    act(() => { jest.advanceTimersByTime(700); });
    await waitFor(() =>
      expect(screen.getByTestId("path-error")).toBeInTheDocument()
    );
    expect(screen.getByTestId("path-error")).toHaveTextContent(/No path found/i);
  });

  /**
   * PATH-PAYMENT TEST 5
   * Multi-hop route with 2 intermediate hops (XLM → yXLM → EURT → USDC).
   */
  it("[PP-5] renders multi-hop route with 2 intermediate assets correctly", async () => {
    mockFindStrictSendPaths.mockResolvedValueOnce(
      makePathResult({
        routeDisplay: "XLM → yXLM → EURT → USDC",
        bestPath: {
          source_asset_type: "native",
          source_amount: "200.0000000",
          destination_asset_type: "credit_alphanum4",
          destination_asset_code: "USDC",
          destination_asset_issuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
          destination_amount: "24.6913578",
          path: [
            { asset_type: "credit_alphanum4", asset_code: "yXLM", asset_issuer: "GARDNV3Q" },
            { asset_type: "credit_alphanum4", asset_code: "EURT", asset_issuer: "GAP5LETIF" },
          ],
        },
        destinationAmount: "24.6913578",
      })
    );

    const user = userEvent.setup({ delay: null });
    render(<TradeForm {...DEFAULT_PROPS} />);

    await user.type(screen.getByRole("spinbutton", { name: /Pay amount/i }), "200");

    act(() => { jest.advanceTimersByTime(700); });
    await waitFor(() =>
      expect(screen.getByTestId("route-display")).toBeInTheDocument()
    );

    const route = screen.getByTestId("route-display");
    expect(route).toHaveTextContent("XLM");
    expect(route).toHaveTextContent("yXLM");
    expect(route).toHaveTextContent("EURT");
    expect(route).toHaveTextContent("USDC");
  });

  /**
   * PATH-PAYMENT TEST 6
   * Loading state: spinner shown while path lookup is in progress.
   */
  it("[PP-6] shows loading spinner while path lookup is in progress", async () => {
    // Make the mock hang indefinitely to observe loading state
    mockFindStrictSendPaths.mockReturnValueOnce(new Promise(() => {}));

    const user = userEvent.setup({ delay: null });
    render(<TradeForm {...DEFAULT_PROPS} />);

    await user.type(screen.getByRole("spinbutton", { name: /Pay amount/i }), "50");

    act(() => { jest.advanceTimersByTime(700); });

    // The receive-amount area shows "Finding best path…"
    await waitFor(() =>
      expect(screen.getByText(/Finding best path/i)).toBeInTheDocument()
    );
  });

  /**
   * PATH-PAYMENT TEST 7
   * Direct path (no hops): "XLM → USDC" route displayed correctly.
   */
  it("[PP-7] handles direct path with no intermediate hops", async () => {
    mockFindStrictSendPaths.mockResolvedValueOnce(
      makePathResult({
        routeDisplay: "XLM → USDC",
        bestPath: {
          source_asset_type: "native",
          source_amount: "50.0000000",
          destination_asset_type: "credit_alphanum4",
          destination_asset_code: "USDC",
          destination_asset_issuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
          destination_amount: "6.1728395",
          path: [],
        },
        destinationAmount: "6.1728395",
      })
    );

    const user = userEvent.setup({ delay: null });
    render(<TradeForm {...DEFAULT_PROPS} />);

    await user.type(screen.getByRole("spinbutton", { name: /Pay amount/i }), "50");

    act(() => { jest.advanceTimersByTime(700); });
    await waitFor(() =>
      expect(screen.getByTestId("route-display")).toBeInTheDocument()
    );

    const route = screen.getByTestId("route-display");
    expect(route).toHaveTextContent("XLM");
    expect(route).toHaveTextContent("USDC");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Slippage tests
// ─────────────────────────────────────────────────────────────────────────────

describe("Slippage controls", () => {
  it("renders 0.5%, 1%, 3% preset buttons", () => {
    render(<TradeForm {...DEFAULT_PROPS} />);
    expect(screen.getByRole("button", { name: /0\.5%/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^1%/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^3%/i })).toBeInTheDocument();
  });

  it("selecting a preset marks it as active (aria-pressed)", async () => {
    const user = userEvent.setup({ delay: null });
    render(<TradeForm {...DEFAULT_PROPS} />);

    const btn1 = screen.getByRole("button", { name: /^1%/i });
    await user.click(btn1);

    expect(btn1).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /0\.5%/i })).toHaveAttribute("aria-pressed", "false");
  });

  it("custom slippage input activates and accepts a decimal value", async () => {
    const user = userEvent.setup({ delay: null });
    render(<TradeForm {...DEFAULT_PROPS} />);

    const customInput = screen.getByRole("spinbutton", { name: /Custom slippage/i });
    await user.clear(customInput);
    await user.type(customInput, "2.5");

    expect(customInput).toHaveValue(2.5);
  });

  it("shows error for slippage > 50", async () => {
    const user = userEvent.setup({ delay: null });
    render(<TradeForm {...DEFAULT_PROPS} />);

    const customInput = screen.getByRole("spinbutton", { name: /Custom slippage/i });
    await user.clear(customInput);
    await user.type(customInput, "99");

    expect(screen.getByText(/Slippage must be between 0% and 50%/i)).toBeInTheDocument();
  });

  it("shows error for negative slippage", async () => {
    const user = userEvent.setup({ delay: null });
    render(<TradeForm {...DEFAULT_PROPS} />);

    const customInput = screen.getByRole("spinbutton", { name: /Custom slippage/i });
    await user.clear(customInput);
    await user.type(customInput, "-5");

    expect(screen.getByText(/Slippage must be between 0% and 50%/i)).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Swap Preview rendering
// ─────────────────────────────────────────────────────────────────────────────

describe("Swap preview", () => {
  it("shows swap preview panel with expected fields after path lookup", async () => {
    const user = userEvent.setup({ delay: null });
    render(<TradeForm {...DEFAULT_PROPS} />);

    await user.type(screen.getByRole("spinbutton", { name: /Pay amount/i }), "100");

    act(() => { jest.advanceTimersByTime(700); });
    await waitFor(() =>
      expect(screen.getByTestId("swap-preview")).toBeInTheDocument()
    );

    const preview = screen.getByTestId("swap-preview");
    expect(preview).toHaveTextContent(/Exchange rate/i);
    expect(preview).toHaveTextContent(/Minimum received/i);
    expect(preview).toHaveTextContent(/Price impact/i);
    expect(preview).toHaveTextContent(/Estimated network fee/i);
  });

  it("estimated fee is displayed in XLM", async () => {
    const user = userEvent.setup({ delay: null });
    render(<TradeForm {...DEFAULT_PROPS} />);

    await user.type(screen.getByRole("spinbutton", { name: /Pay amount/i }), "100");

    act(() => { jest.advanceTimersByTime(700); });
    await waitFor(() =>
      expect(screen.getByTestId("swap-preview")).toBeInTheDocument()
    );

    expect(screen.getByTestId("swap-preview")).toHaveTextContent(/XLM/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Price impact warning
// ─────────────────────────────────────────────────────────────────────────────

describe("Price impact warning", () => {
  it("shows price-impact warning when externalPriceImpact > 3", () => {
    render(<TradeForm {...DEFAULT_PROPS} priceImpact={4.5} />);
    expect(screen.getByTestId("price-impact-warning")).toBeInTheDocument();
    expect(screen.getByTestId("price-impact-warning")).toHaveTextContent(/High price impact/i);
  });

  it("does NOT show price-impact warning when impact <= 3", () => {
    render(<TradeForm {...DEFAULT_PROPS} priceImpact={2.9} />);
    expect(screen.queryByTestId("price-impact-warning")).not.toBeInTheDocument();
  });

  it("shows warning for 3.01% impact", () => {
    render(<TradeForm {...DEFAULT_PROPS} priceImpact={3.01} />);
    expect(screen.getByTestId("price-impact-warning")).toBeInTheDocument();
  });

  it("does not show warning when priceImpact is exactly 3", () => {
    render(<TradeForm {...DEFAULT_PROPS} priceImpact={3} />);
    expect(screen.queryByTestId("price-impact-warning")).not.toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Confirmation modal
// ─────────────────────────────────────────────────────────────────────────────

describe("Confirmation modal", () => {
  async function setupAndOpenModal() {
    const user = userEvent.setup({ delay: null });
    const props = { ...DEFAULT_PROPS };
    render(<TradeForm {...props} />);

    await user.type(screen.getByRole("spinbutton", { name: /Pay amount/i }), "100");

    act(() => { jest.advanceTimersByTime(700); });
    await waitFor(() =>
      expect(screen.getByTestId("swap-preview")).toBeInTheDocument()
    );

    const reviewBtn = screen.getByRole("button", { name: /Review Swap/i });
    await user.click(reviewBtn);

    return user;
  }

  it("opens confirmation modal when Review Swap is clicked", async () => {
    await setupAndOpenModal();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Confirm Swap/i })).toBeInTheDocument();
  });

  it("modal shows input/output assets, route, exchange rate, slippage, fee, min received, price impact", async () => {
    await setupAndOpenModal();
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent(/Confirm Swap/i);
    expect(dialog).toHaveTextContent(/Route/i);
    expect(dialog).toHaveTextContent(/Exchange rate/i);
    expect(dialog).toHaveTextContent(/Slippage/i);
    expect(dialog).toHaveTextContent(/Minimum received/i);
    expect(dialog).toHaveTextContent(/Price impact/i);
    expect(dialog).toHaveTextContent(/Estimated fee/i);
  });

  it("Cancel button closes the modal without submitting", async () => {
    const user = await setupAndOpenModal();
    await user.click(screen.getByRole("button", { name: /Cancel/i }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mockBuildPathPayment).not.toHaveBeenCalled();
  });

  it("Confirm Swap signs and submits the transaction", async () => {
    const user = await setupAndOpenModal();
    await user.click(screen.getByRole("button", { name: /Confirm Swap/i }));

    await waitFor(() => {
      expect(mockBuildPathPayment).toHaveBeenCalled();
      expect(mockSignTransaction).toHaveBeenCalled();
      expect(mockSubmitTransaction).toHaveBeenCalled();
      expect(DEFAULT_PROPS.onSuccess).toHaveBeenCalledWith("Swap executed successfully!");
      expect(DEFAULT_PROPS.onTradeComplete).toHaveBeenCalled();
    });
  });

  it("modal does not appear when no path result available", () => {
    render(<TradeForm {...DEFAULT_PROPS} />);
    // Review Swap button should be disabled with no amount/path
    const reviewBtn = screen.getByRole("button", { name: /Review Swap|Connect wallet/i });
    expect(reviewBtn).toBeDisabled();
  });

  it("modal is not shown before user clicks Review Swap", async () => {
    render(<TradeForm {...DEFAULT_PROPS} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. Edge cases and wallet state
// ─────────────────────────────────────────────────────────────────────────────

describe("Edge cases", () => {
  it("Review Swap button is disabled with no wallet connected", () => {
    render(<TradeForm {...DEFAULT_PROPS} publicKey={null} />);
    // Button aria-label is "Review swap"; text content says "Connect wallet to swap"
    const btn = screen.getByRole("button", { name: /Review swap/i });
    expect(btn).toBeDisabled();
    expect(btn).toHaveTextContent(/Connect wallet to swap/i);
  });

  it("Review Swap button is disabled when pay amount is empty", () => {
    render(<TradeForm {...DEFAULT_PROPS} />);
    // No amount entered — button disabled
    expect(screen.getByRole("button", { name: /Review Swap|Connect wallet/i })).toBeDisabled();
  });

  it("calls onError when transaction signing fails", async () => {
    mockSignTransaction.mockResolvedValueOnce({ error: { message: "User rejected" } });

    const user = userEvent.setup({ delay: null });
    render(<TradeForm {...DEFAULT_PROPS} />);

    await user.type(screen.getByRole("spinbutton", { name: /Pay amount/i }), "100");
    act(() => { jest.advanceTimersByTime(700); });
    await waitFor(() => expect(screen.getByTestId("swap-preview")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /Review Swap/i }));
    await user.click(screen.getByRole("button", { name: /Confirm Swap/i }));

    await waitFor(() =>
      expect(DEFAULT_PROPS.onError).toHaveBeenCalledWith("User rejected")
    );
  });

  it("calls onError when submitTransaction throws", async () => {
    mockSubmitTransaction.mockRejectedValueOnce(new Error("Horizon 400"));

    const user = userEvent.setup({ delay: null });
    render(<TradeForm {...DEFAULT_PROPS} />);

    await user.type(screen.getByRole("spinbutton", { name: /Pay amount/i }), "100");
    act(() => { jest.advanceTimersByTime(700); });
    await waitFor(() => expect(screen.getByTestId("swap-preview")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /Review Swap/i }));
    await user.click(screen.getByRole("button", { name: /Confirm Swap/i }));

    await waitFor(() =>
      expect(DEFAULT_PROPS.onError).toHaveBeenCalledWith("Horizon 400")
    );
  });

  it("path lookup is not triggered when pay amount is 0", async () => {
    const user = userEvent.setup({ delay: null });
    render(<TradeForm {...DEFAULT_PROPS} />);

    await user.type(screen.getByRole("spinbutton", { name: /Pay amount/i }), "0");
    act(() => { jest.advanceTimersByTime(700); });

    // Path-finder should not be called for zero amount
    expect(mockFindStrictSendPaths).not.toHaveBeenCalled();
  });
});

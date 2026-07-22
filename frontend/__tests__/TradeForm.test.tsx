import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Mock stellar dependencies before importing component
jest.mock("@/lib/stellar", () => ({
  buildSellOfferTransaction: jest.fn(),
  buildBuyOfferTransaction: jest.fn(),
  buildPathPaymentTransaction: jest.fn(),
  submitTransaction: jest.fn(),
  NETWORK_PASSPHRASE: "Test SDF Network ; October 2015",
}));

jest.mock("@stellar/freighter-api", () => ({
  signTransaction: jest.fn(),
}));

jest.mock("@/components/icons", () => ({
  SwapIcon: () => <span data-testid="swap-icon">SwapIcon</span>,
}));

import TradeForm from "../components/TradeForm";
import * as stellarModule from "@/lib/stellar";
import * as freighterModule from "@stellar/freighter-api";

const mockBuildSellOfferTransaction = stellarModule.buildSellOfferTransaction as jest.Mock;
const mockBuildBuyOfferTransaction = stellarModule.buildBuyOfferTransaction as jest.Mock;
const mockBuildPathPaymentTransaction = stellarModule.buildPathPaymentTransaction as jest.Mock;
const mockSubmitTransaction = stellarModule.submitTransaction as jest.Mock;
const mockSignTransaction = freighterModule.signTransaction as jest.Mock;

describe("TradeForm Component", () => {
  const defaultProps = {
    publicKey: "GBRPYHIL2CI3WHZDTOOQFC6EB4RRJC3D5NZ2KMSUGSRNVO7ZFGIGSZ",
    onTradeComplete: jest.fn(),
    onError: jest.fn(),
    onSuccess: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockBuildPathPaymentTransaction.mockResolvedValue({ toXDR: () => "mock-path-tx-xdr" });
    mockBuildSellOfferTransaction.mockResolvedValue({ toXDR: () => "mock-sell-tx-xdr" });
    mockBuildBuyOfferTransaction.mockResolvedValue({ toXDR: () => "mock-buy-tx-xdr" });
    mockSignTransaction.mockResolvedValue({ signedTxXdr: "mock-signed-tx-xdr" });
    mockSubmitTransaction.mockResolvedValue({ hash: "tx999" });
  });

  it("Asset pair selector renders available pairs", () => {
    render(<TradeForm {...defaultProps} />);

    const sellingSelect = screen.getByRole("combobox", { name: /Selling asset/i });
    const buyingSelect = screen.getByRole("combobox", { name: /Buying asset/i });

    expect(sellingSelect).toBeInTheDocument();
    expect(buyingSelect).toBeInTheDocument();

    const sellingOptions = Array.from(sellingSelect.querySelectorAll("option")).map((o) => o.value);
    const buyingOptions = Array.from(buyingSelect.querySelectorAll("option")).map((o) => o.value);

    expect(sellingOptions).toEqual(["XLM", "USDC"]);
    expect(buyingOptions).toEqual(["XLM", "USDC"]);
  });

  it("Slippage tolerance input validates 0–50% range", async () => {
    const user = userEvent.setup();
    render(<TradeForm {...defaultProps} />);

    const slippageInput = screen.getByPlaceholderText("0.5");
    expect(slippageInput).toBeInTheDocument();

    // Input invalid negative slippage
    await user.clear(slippageInput);
    await user.type(slippageInput, "-1");

    expect(screen.getByText("Slippage tolerance must be between 0% and 50%")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Execute Market Order/i })).toBeDisabled();

    // Input invalid high slippage (>50)
    await user.clear(slippageInput);
    await user.type(slippageInput, "55");

    expect(screen.getByText("Slippage tolerance must be between 0% and 50%")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Execute Market Order/i })).toBeDisabled();

    // Input valid slippage (2.5)
    await user.clear(slippageInput);
    await user.type(slippageInput, "2.5");

    expect(screen.queryByText("Slippage tolerance must be between 0% and 50%")).not.toBeInTheDocument();
  });

  it("'Swap' button disabled when wallet not connected", () => {
    render(<TradeForm {...defaultProps} publicKey={null} />);

    const swapBtn = screen.getByRole("button", { name: /Swap assets/i });
    expect(swapBtn).toBeDisabled();

    const submitBtn = screen.getByRole("button", { name: /Execute Market Order/i });
    expect(submitBtn).toBeDisabled();
  });

  it("Price impact warning shown when impact > 5%", async () => {
    const user = userEvent.setup();

    // Render with explicit high price impact
    const { rerender } = render(<TradeForm {...defaultProps} priceImpact={6.2} />);
    expect(screen.getByText("Warning: High price impact (>5%)")).toBeInTheDocument();

    // Rerender with low price impact
    rerender(<TradeForm {...defaultProps} priceImpact={1.5} />);
    expect(screen.queryByText("Warning: High price impact (>5%)")).not.toBeInTheDocument();

    // Test automatic price impact warning for large amount (>1000)
    render(<TradeForm {...defaultProps} />);
    const amountInput = screen.getByPlaceholderText("0.00");
    await user.type(amountInput, "2000");

    expect(screen.getByText("Warning: High price impact (>5%)")).toBeInTheDocument();
  });

  it("swaps assets when Swap button is clicked", async () => {
    const user = userEvent.setup();
    render(<TradeForm {...defaultProps} />);

    const sellingSelect = screen.getByRole("combobox", { name: /Selling asset/i }) as HTMLSelectElement;
    const buyingSelect = screen.getByRole("combobox", { name: /Buying asset/i }) as HTMLSelectElement;

    expect(sellingSelect.value).toBe("XLM");
    expect(buyingSelect.value).toBe("USDC");

    await user.click(screen.getByRole("button", { name: /Swap assets/i }));

    expect(sellingSelect.value).toBe("USDC");
    expect(buyingSelect.value).toBe("XLM");
  });

  it("executes Market Order successfully", async () => {
    const user = userEvent.setup();
    render(<TradeForm {...defaultProps} />);

    const amountInput = screen.getByPlaceholderText("0.00");
    await user.type(amountInput, "100");

    const submitBtn = screen.getByRole("button", { name: /Execute Market Order/i });
    expect(submitBtn).toBeEnabled();

    await user.click(submitBtn);

    await waitFor(() => {
      expect(mockBuildPathPaymentTransaction).toHaveBeenCalled();
      expect(mockSignTransaction).toHaveBeenCalled();
      expect(mockSubmitTransaction).toHaveBeenCalled();
      expect(defaultProps.onSuccess).toHaveBeenCalledWith("Market order executed successfully!");
      expect(defaultProps.onTradeComplete).toHaveBeenCalled();
    });
  });

  it("places Limit Order successfully", async () => {
    const user = userEvent.setup();
    render(<TradeForm {...defaultProps} />);

    // Switch to Limit Order
    await user.click(screen.getByRole("button", { name: /Limit Order/i }));

    expect(screen.getByRole("button", { name: /Place Buy Order/i })).toBeDisabled();

    // Fill amount and price
    await user.type(screen.getByPlaceholderText("0.00"), "50");
    await user.type(screen.getByPlaceholderText("Price"), "0.15");

    const submitBtn = screen.getByRole("button", { name: /Place Buy Order/i });
    expect(submitBtn).toBeEnabled();

    await user.click(submitBtn);

    await waitFor(() => {
      expect(mockBuildBuyOfferTransaction).toHaveBeenCalled();
      expect(mockSignTransaction).toHaveBeenCalled();
      expect(mockSubmitTransaction).toHaveBeenCalled();
      expect(defaultProps.onSuccess).toHaveBeenCalledWith("Buy order placed successfully!");
      expect(defaultProps.onTradeComplete).toHaveBeenCalled();
    });
  });
});

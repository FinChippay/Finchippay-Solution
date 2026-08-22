import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import QuickAddPanel from "../components/QuickAddPanel";

// Mock framer-motion components
jest.mock("framer-motion", () => ({
  motion: {
    button: ({ children, whileHover: _whileHover, whileTap: _whileTap, ...props }: any) => (
      <button {...props}>{children}</button>
    ),
    div: ({ children, whileHover: _whileHover, whileTap: _whileTap, ...props }: any) => (
      <div {...props}>{children}</div>
    ),
  },
}));

describe("QuickAddPanel", () => {
  const defaultProps = {
    xlmBalance: "250.50",
    usdcBalance: "1200.00",
    onTokenSelect: jest.fn(),
    onPresetAmount: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders Quick Add heading, tokens with balances, and preset amounts", () => {
    render(<QuickAddPanel {...defaultProps} />);

    expect(screen.getByText("Quick Add")).toBeInTheDocument();
    expect(screen.getByText("XLM")).toBeInTheDocument();
    expect(screen.getByText("Balance: 250.50 XLM")).toBeInTheDocument();
    expect(screen.getByText("USDC")).toBeInTheDocument();
    expect(screen.getByText("Balance: 1200.00 USDC")).toBeInTheDocument();

    expect(screen.getByRole("button", { name: "Preset amount 10 XLM" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Preset amount 100 USDC" })).toBeInTheDocument();
  });

  it("triggers onTokenSelect when a token card is clicked or activated with keyboard", async () => {
    const user = userEvent.setup();
    render(<QuickAddPanel {...defaultProps} />);

    const xlmCard = screen.getByRole("button", { name: /drag xlm to set token/i });
    await user.click(xlmCard);
    expect(defaultProps.onTokenSelect).toHaveBeenCalledWith("XLM");

    const usdcCard = screen.getByRole("button", { name: /drag usdc to set token/i });
    fireEvent.keyDown(usdcCard, { key: "Enter" });
    expect(defaultProps.onTokenSelect).toHaveBeenCalledWith("USDC");
  });

  it("triggers onPresetAmount when a preset button is clicked", async () => {
    const user = userEvent.setup();
    render(<QuickAddPanel {...defaultProps} />);

    const preset100USDC = screen.getByRole("button", { name: "Preset amount 100 USDC" });
    await user.click(preset100USDC);
    expect(defaultProps.onPresetAmount).toHaveBeenCalledWith("100");
  });

  it("sets correct dataTransfer payload when dragging a token", () => {
    render(<QuickAddPanel {...defaultProps} />);

    const xlmCard = screen.getByRole("button", { name: /drag xlm to set token/i });
    const setDataMock = jest.fn();

    fireEvent.dragStart(xlmCard, {
      dataTransfer: {
        setData: setDataMock,
        effectAllowed: "",
      },
    });

    expect(setDataMock).toHaveBeenCalledWith(
      "application/json",
      JSON.stringify({ type: "token", value: "XLM" })
    );
  });

  it("sets correct dataTransfer payload when dragging a preset amount", () => {
    render(<QuickAddPanel {...defaultProps} />);

    const preset50XLM = screen.getByRole("button", { name: "Preset amount 50 XLM" });
    const setDataMock = jest.fn();

    fireEvent.dragStart(preset50XLM, {
      dataTransfer: {
        setData: setDataMock,
        effectAllowed: "",
      },
    });

    expect(setDataMock).toHaveBeenCalledWith(
      "application/json",
      JSON.stringify({ type: "amount", value: "50" })
    );
  });
});

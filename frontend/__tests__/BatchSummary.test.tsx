import React from "react";
import { render, screen } from "@testing-library/react";
import BatchSummary from "../components/BatchSummary";

// Mock framer-motion components
jest.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  },
}));

describe("BatchSummary", () => {
  it("renders zero state when no valid recipients exist", () => {
    render(<BatchSummary recipients={[]} />);

    expect(screen.getByText("Batch Summary")).toBeInTheDocument();
    expect(screen.getByText("0 / 10 recipients")).toBeInTheDocument();
    expect(
      screen.getByText("Add recipients with valid addresses and amounts to see the summary.")
    ).toBeInTheDocument();
  });

  it("calculates totals per token and displays token distribution bar chart", () => {
    const recipients = [
      {
        address: "GA2C5RFPE6GCKMY3US5PAB4UZLKIGF42QD2VXYL43AYVR2AKXT672LAE",
        amount: "100",
        token: { code: "XLM" },
      },
      {
        address: "GBBD47IFQTWJG7QNO6O74H5GLT4H3PTJQ4XHMFNKDQYSCY5BXKDY3J7B",
        amount: "50",
        token: { code: "XLM" },
      },
      {
        address: "GCD47IFQTWJG7QNO6O74H5GLT4H3PTJQ4XHMFNKDQYSCY5BXKDY3J7C",
        amount: "25",
        token: { code: "USDC" },
      },
    ];

    render(<BatchSummary recipients={recipients} maxRecipients={10} />);

    expect(screen.getByText("3 / 10 recipients")).toBeInTheDocument();
    expect(screen.getByText("150.00 XLM")).toBeInTheDocument();
    expect(screen.getByText("25.00 USDC")).toBeInTheDocument();
    expect(screen.getByText("150.00 XLM + 25.00 USDC")).toBeInTheDocument();
    expect(screen.getByText(/Estimated fee/i)).toBeInTheDocument();
  });

  it("ignores invalid amounts and empty addresses in totals calculation", () => {
    const recipients = [
      {
        address: "GA2C5RFPE6GCKMY3US5PAB4UZLKIGF42QD2VXYL43AYVR2AKXT672LAE",
        amount: "50",
        token: { code: "XLM" },
      },
      {
        address: "",
        amount: "100",
        token: { code: "XLM" },
      },
      {
        address: "GBBD47IFQTWJG7QNO6O74H5GLT4H3PTJQ4XHMFNKDQYSCY5BXKDY3J7B",
        amount: "invalid-amount",
        token: { code: "USDC" },
      },
    ];

    render(<BatchSummary recipients={recipients} />);

    expect(screen.getByText("1 / 10 recipients")).toBeInTheDocument();
    expect(screen.getAllByText("50.00 XLM").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("USDC")).not.toBeInTheDocument();
  });
});

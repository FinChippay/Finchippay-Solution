import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import ReceiptCard from "../components/ReceiptCard";

describe("ReceiptCard", () => {
  const mockReceipt = {
    from: "GBXXABC1234567890ABCDEF1234567890ABCDEF",
    to: "GAYYXYZ0987654321XYZABCD0987654321XYZABCD",
    amount: "500000000", // 50 XLM
    timestamp: 1672531200, // Jan 1, 2023
    memo: "Payment for services",
    ledger: 123456
  };

  it("renders receipt details correctly", () => {
    const mockOnViewDetails = jest.fn();
    render(<ReceiptCard index={42} receipt={mockReceipt} onViewDetails={mockOnViewDetails} />);

    expect(screen.getByText("#42")).toBeInTheDocument();
    expect(screen.getByText("50 XLM")).toBeInTheDocument();
    expect(screen.getByText("Payment for services")).toBeInTheDocument();
    
    // Addresses should be shortened
    expect(screen.getByText("GBXXABC...BCDEF")).toBeInTheDocument();
    expect(screen.getByText("GAYYXYZ...ZABCD")).toBeInTheDocument();
  });

  it("calls onViewDetails when button is clicked", () => {
    const mockOnViewDetails = jest.fn();
    render(<ReceiptCard index={42} receipt={mockReceipt} onViewDetails={mockOnViewDetails} />);

    fireEvent.click(screen.getByText("View Details"));
    expect(mockOnViewDetails).toHaveBeenCalledWith(42);
  });

  it("renders correctly without a memo", () => {
    const mockOnViewDetails = jest.fn();
    render(<ReceiptCard index={1} receipt={{ ...mockReceipt, memo: "" }} onViewDetails={mockOnViewDetails} />);

    expect(screen.queryByText("Memo")).not.toBeInTheDocument();
  });
});

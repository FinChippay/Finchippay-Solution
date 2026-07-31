/**
 * __tests__/TransactionSearchBar.test.tsx
 * Tests for TransactionSearchBar component
 */

import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import TransactionSearchBar from "@/components/TransactionSearchBar";
import { PaymentRecord } from "@/lib/stellar";

// Mock the search functions
jest.mock("@/lib/transactionSearch", () => ({
  searchPayments: jest.fn((payments, query) => {
    if (!query) return [];
    return payments
      .filter((p) => p.memo?.includes(query) || p.hash?.includes(query))
      .map((p) => ({
        payment: p,
        relevance: 5,
        highlights: { memo: [], address: [], hash: [] },
      }));
  }),
  parseSearchQuery: jest.fn((query) => ({
    text: query,
    from: query.includes("from:") ? "GTEST" : undefined,
    to: query.includes("to:") ? "GTEST" : undefined,
  })),
  tokenizeText: jest.fn((text) => text.split(" ")),
}));

jest.mock("@/lib/transactionSearchIndex", () => ({
  buildIndex: jest.fn(() => new Map()),
  saveIndexedDB: jest.fn(async () => {}),
  loadIndexedDB: jest.fn(async () => null),
}));

describe("TransactionSearchBar", () => {
  const mockPayments: PaymentRecord[] = [
    {
      id: "1",
      type: "payment",
      from: "GA2C5RFPE6GCKMY3US5PAB4UZLKIGF42QD2VXYL43AYVR2AKXT672LAE",
      to: "GBBD47IFQTWJG7QNO6O74H5GLT4H3PTJQ4XHMFNKDQYSCY5BXKDY3J7B",
      amount: "100",
      asset: "XLM:native",
      memo: "Test payment",
      hash: "abc123",
      createdAt: new Date(),
      status: "success",
    },
  ];

  const mockOnSearchResults = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders search input", () => {
    render(
      <TransactionSearchBar
        payments={mockPayments}
        onSearchResults={mockOnSearchResults}
      />
    );
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  it("displays help text when empty", () => {
    render(
      <TransactionSearchBar
        payments={mockPayments}
        onSearchResults={mockOnSearchResults}
      />
    );
    expect(screen.getByText(/Operators/)).toBeInTheDocument();
  });

  it("calls onSearchResults when typing", async () => {
    jest.useFakeTimers();
    render(
      <TransactionSearchBar
        payments={mockPayments}
        onSearchResults={mockOnSearchResults}
      />
    );

    const input = screen.getByRole("textbox");
    await userEvent.type(input, "test");

    jest.advanceTimersByTime(150);

    await waitFor(() => {
      expect(mockOnSearchResults).toHaveBeenCalled();
    });

    jest.useRealTimers();
  });

  it("clears search when clicking clear button", async () => {
    render(
      <TransactionSearchBar
        payments={mockPayments}
        onSearchResults={mockOnSearchResults}
      />
    );

    const input = screen.getByRole("textbox") as HTMLInputElement;
    await userEvent.type(input, "test");

    expect(input.value).toBe("test");

    const clearButton = screen.getByLabelText("Clear search");
    fireEvent.click(clearButton);

    expect(input.value).toBe("");
  });

  it("displays operator badge when operators are used", async () => {
    jest.useFakeTimers();
    render(
      <TransactionSearchBar
        payments={mockPayments}
        onSearchResults={mockOnSearchResults}
      />
    );

    const input = screen.getByRole("textbox");
    await userEvent.type(input, "from:GTEST");

    jest.advanceTimersByTime(150);

    await waitFor(() => {
      expect(screen.getByText(/from/)).toBeInTheDocument();
    });

    jest.useRealTimers();
  });

  it("handles empty search results", async () => {
    jest.useFakeTimers();
    render(
      <TransactionSearchBar
        payments={mockPayments}
        onSearchResults={mockOnSearchResults}
      />
    );

    const input = screen.getByRole("textbox");
    await userEvent.type(input, "nonexistent");

    jest.advanceTimersByTime(150);

    await waitFor(() => {
      expect(mockOnSearchResults).toHaveBeenCalledWith([]);
    });

    jest.useRealTimers();
  });
});

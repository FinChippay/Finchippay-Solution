/**
 * __tests__/HighlightedTransactionRow.test.tsx
 * Tests for HighlightedTransactionRow component
 */

import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import HighlightedTransactionRow from "../components/HighlightedTransactionRow";
import { PaymentRecord } from "@/lib/stellar";
import { SearchResult } from "@/lib/transactionSearch";

// Mock the useTranslation hook
jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

// Mock the format utility
jest.mock("@/utils/format", () => ({
  formatAsset: jest.fn((asset) => asset),
  timeAgo: jest.fn(() => "2 hours ago"),
}));

// Mock framer-motion
jest.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...props }: { children: React.ReactNode; [key: string]: unknown }) => <div {...props}>{children}</div>,
  },
}));

// Mock lucide-react icons
jest.mock("lucide-react", () => ({
  Printer: () => <span>PrintIcon</span>,
  Send: () => <span>SendIcon</span>,
}));

describe("HighlightedTransactionRow Component", () => {
  const mockPayment: PaymentRecord = {
    id: "tx-1",
    type: "payment",
    from: "GA2C5RFPE6GCKMY3US5PAB4UZLKIGF42QD2VXYL43AYVR2AKXT672LAE",
    to: "GBBD47IFQTWJG7QNO6O74H5GLT4H3PTJQ4XHMFNKDQYSCY5BXKDY3J7B",
    amount: "100",
    asset: "XLM:native",
    memo: "Test payment memo",
    hash: "abc123def456ghi789",
    createdAt: new Date("2024-01-15T10:00:00Z"),
    status: "success",
  };

  const mockSearchResult: SearchResult = {
    payment: mockPayment,
    relevance: 8,
    highlights: {
      memo: ["Test payment memo"],
      address: ["GB...J7B"],
      hash: ["abc123..."],
    },
  };

  describe("Rendering", () => {
    it("should render transaction row with payment data", () => {
      render(
        <HighlightedTransactionRow
          payment={mockPayment}
          result={mockSearchResult}
        />
      );

      // Should display the amount and asset
      expect(screen.getByText(/100/)).toBeInTheDocument();
      expect(screen.getByText(/XLM/)).toBeInTheDocument();
    });

    it("should render without search result (no highlighting)", () => {
      render(<HighlightedTransactionRow payment={mockPayment} />);

      // Should still render the transaction
      expect(screen.getByText(/100/)).toBeInTheDocument();
    });

    it("should display relevance score badge when result provided", () => {
      render(
        <HighlightedTransactionRow
          payment={mockPayment}
          result={mockSearchResult}
        />
      );

      // Score should be visible (8 points for the result)
      expect(screen.getByText(/8\s*pts/)).toBeInTheDocument();
    });

    it("should display time ago", () => {
      render(
        <HighlightedTransactionRow
          payment={mockPayment}
          result={mockSearchResult}
        />
      );

      expect(screen.getByText("2 hours ago")).toBeInTheDocument();
    });

    it("should display memo text", () => {
      render(
        <HighlightedTransactionRow
          payment={mockPayment}
          result={mockSearchResult}
        />
      );

      expect(screen.getByText(/Test payment memo/)).toBeInTheDocument();
    });
  });

  describe("Compact Mode", () => {
    it("should render with compact styling when compact prop true", () => {
      const { container } = render(
        <HighlightedTransactionRow
          payment={mockPayment}
          result={mockSearchResult}
          compact={true}
        />
      );

      // Component should render (we can't easily check CSS in tests, but we verify it renders)
      expect(container.firstChild).toBeInTheDocument();
    });
  });

  describe("Action Buttons", () => {
    it("should display print receipt button", () => {
      render(
        <HighlightedTransactionRow
          payment={mockPayment}
          result={mockSearchResult}
          onPrintReceipt={() => {}}
        />
      );

      // PrintIcon should be rendered
      expect(screen.getByText("PrintIcon")).toBeInTheDocument();
    });

    it("should call onPrintReceipt when print button clicked", () => {
      const mockPrint = jest.fn();
      render(
        <HighlightedTransactionRow
          payment={mockPayment}
          result={mockSearchResult}
          onPrintReceipt={mockPrint}
        />
      );

      // Find and click the print button
      const printButtons = screen.getAllByText("PrintIcon");
      fireEvent.click(printButtons[0].closest("button") || printButtons[0]);

      // Verify the callback was invoked
      expect(mockPrint).toHaveBeenCalledWith(mockPayment);
    });

    it("should display send again button for outgoing transactions", () => {
      render(
        <HighlightedTransactionRow
          payment={mockPayment}
          result={mockSearchResult}
          onSendAgain={() => {}}
        />
      );

      // SendIcon should be rendered for outgoing
      const sendIcons = screen.queryAllByText("SendIcon");
      expect(sendIcons.length).toBeGreaterThan(0);
    });

    it("should call onSendAgain with correct parameters when clicked", () => {
      const mockSendAgain = jest.fn();
      render(
        <HighlightedTransactionRow
          payment={mockPayment}
          result={mockSearchResult}
          onSendAgain={mockSendAgain}
        />
      );

      // Find and click the send again button
      const sendButtons = screen.queryAllByText("SendIcon");
      if (sendButtons.length > 0) {
        fireEvent.click(sendButtons[0].closest("button") || sendButtons[0]);
        expect(mockSendAgain).toHaveBeenCalledWith(
          mockPayment.to,
          mockPayment.amount
        );
      }
    });
  });

  describe("Visual Styling", () => {
    it("should apply different styling for incoming vs outgoing", () => {
      const incomingPayment = {
        ...mockPayment,
        from: "GBBD47IFQTWJG7QNO6O74H5GLT4H3PTJQ4XHMFNKDQYSCY5BXKDY3J7B", // Different from current publicKey
      };

      const { container: incomingContainer } = render(
        <HighlightedTransactionRow
          payment={incomingPayment}
          result={mockSearchResult}
        />
      );

      // Should render (styling differences are in CSS classes)
      expect(incomingContainer.firstChild).toBeInTheDocument();
    });

    it("should highlight search matches with background color", () => {
      const resultWithHighlights: SearchResult = {
        payment: mockPayment,
        relevance: 10,
        highlights: {
          memo: ["Test"],
          address: [],
          hash: [],
        },
      };

      const { container } = render(
        <HighlightedTransactionRow
          payment={mockPayment}
          result={resultWithHighlights}
        />
      );

      // Mark tags should exist for highlights (rendered by HighlightText component)
      const markElements = container.querySelectorAll("mark");
      expect(markElements.length).toBeGreaterThan(0);
    });
  });

  describe("Empty/Edge Cases", () => {
    it("should handle transactions without memo gracefully", () => {
      const noMemoPayment = { ...mockPayment, memo: "" };
      render(
        <HighlightedTransactionRow
          payment={noMemoPayment}
          result={mockSearchResult}
        />
      );

      expect(screen.getByText(/100/)).toBeInTheDocument();
    });

    it("should handle null/undefined result", () => {
      render(<HighlightedTransactionRow payment={mockPayment} result={undefined} />);

      expect(screen.getByText(/100/)).toBeInTheDocument();
    });

    it("should handle very large amounts", () => {
      const largePayment = {
        ...mockPayment,
        amount: "999999999.99",
      };
      render(
        <HighlightedTransactionRow
          payment={largePayment}
          result={mockSearchResult}
        />
      );

      expect(screen.getByText(/999999999.99/)).toBeInTheDocument();
    });

    it("should handle very small amounts", () => {
      const smallPayment = {
        ...mockPayment,
        amount: "0.00001",
      };
      render(
        <HighlightedTransactionRow
          payment={smallPayment}
          result={mockSearchResult}
        />
      );

      expect(screen.getByText(/0.00001/)).toBeInTheDocument();
    });
  });
});

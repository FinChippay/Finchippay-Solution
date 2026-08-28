/**
 * __tests__/TransactionDetail.test.tsx
 * Unit tests for transaction detail components
 */

import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import TransactionTimeline from "@/components/TransactionTimeline";
import TransactionActions from "@/components/TransactionActions";

// Mock framer-motion
jest.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...props }: { children?: React.ReactNode; [key: string]: unknown }) => (
      <div {...props}>{children}</div>
    ),
    button: ({ children, ...props }: { children?: React.ReactNode; [key: string]: unknown }) => (
      <button {...props}>{children}</button>
    ),
  },
  AnimatePresence: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

// Mock next/router
jest.mock("next/router", () => ({
  useRouter: () => ({
    push: jest.fn(),
    query: {},
    pathname: "/",
  }),
}));

describe("TransactionTimeline", () => {
  it("renders all timeline steps", () => {
    const steps = [
      { label: "Created", timestamp: "2024-01-01T00:00:00Z", status: "completed" as const },
      { label: "Signed", timestamp: "2024-01-01T00:00:01Z", status: "completed" as const },
      { label: "Submitted", timestamp: "2024-01-01T00:00:02Z", status: "completed" as const },
      { label: "Confirmed", timestamp: "2024-01-01T00:00:03Z", status: "completed" as const },
    ];

    render(<TransactionTimeline steps={steps} />);

    expect(screen.getByText("Created")).toBeInTheDocument();
    expect(screen.getByText("Signed")).toBeInTheDocument();
    expect(screen.getByText("Submitted")).toBeInTheDocument();
    expect(screen.getByText("Confirmed")).toBeInTheDocument();
  });

  it("renders current step with animation", () => {
    const steps = [
      { label: "Created", status: "completed" as const },
      { label: "Processing", status: "current" as const },
      { label: "Confirmed", status: "pending" as const },
    ];

    render(<TransactionTimeline steps={steps} />);

    expect(screen.getByText("Processing")).toBeInTheDocument();
  });

  it("renders pending steps correctly", () => {
    const steps = [
      { label: "Created", status: "completed" as const },
      { label: "Pending", status: "pending" as const },
    ];

    render(<TransactionTimeline steps={steps} />);

    expect(screen.getByText("Pending")).toBeInTheDocument();
  });
});

describe("TransactionActions", () => {
  const mockTransaction = {
    hash: "abc123def456",
    ledger: 12345,
    createdAt: "2024-01-01T00:00:00Z",
    sourceAccount: "GABC123",
    fee: "0.00001",
    successful: true,
  };

  beforeEach(() => {
    // Mock clipboard API
    Object.assign(navigator, {
      clipboard: {
        writeText: jest.fn(() => Promise.resolve()),
      },
    });
  });

  it("renders all action buttons", () => {
    render(
      <TransactionActions
        transactionHash={mockTransaction.hash}
        transaction={mockTransaction}
      />
    );

    expect(screen.getByText("View on Explorer")).toBeInTheDocument();
    expect(screen.getByText("Copy Hash")).toBeInTheDocument();
    expect(screen.getByText("Share Receipt")).toBeInTheDocument();
    expect(screen.getByText("Download PDF")).toBeInTheDocument();
  });

  it("copies transaction hash to clipboard", async () => {
    render(
      <TransactionActions
        transactionHash={mockTransaction.hash}
        transaction={mockTransaction}
      />
    );

    const copyButton = screen.getByText("Copy Hash");
    fireEvent.click(copyButton);

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(mockTransaction.hash);
    });
  });

  it("shows Copied! message after copying", async () => {
    render(
      <TransactionActions
        transactionHash={mockTransaction.hash}
        transaction={mockTransaction}
      />
    );

    const copyButton = screen.getByText("Copy Hash");
    fireEvent.click(copyButton);

    await waitFor(() => {
      expect(screen.getByText("Copied!")).toBeInTheDocument();
    });
  });
});

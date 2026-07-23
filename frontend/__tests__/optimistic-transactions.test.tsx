import { render, screen, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import TransactionList from "@/components/TransactionList";
import { PaymentRecord } from "@/lib/stellar";

jest.mock("next/router", () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock("@/lib/stellar", () => ({
  getPaymentHistory: jest.fn().mockResolvedValue({
    records: [],
    hasMore: false,
  }),
  shortenAddress: (addr: string) => addr.slice(0, 5) + "...",
  explorerUrl: () => "https://stellar.expert",
}));

describe("Optimistic UI Updates for Transactions", () => {
  beforeEach(() => {
    sessionStorage.clear();
    jest.clearAllMocks();
  });

  it("injects a mock pending entry into the view array immediately following signature execution", async () => {
    render(<TransactionList publicKey="GBMOCK" />);

    // Give it a moment to render loading state and resolve fetch
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const pendingTx: PaymentRecord = {
      id: "pending-123",
      type: "sent",
      amount: "10.0000000",
      asset: "XLM",
      from: "GBMOCK",
      to: "GDTEST",
      createdAt: new Date().toISOString(),
      transactionHash: "pending-123",
      isPending: true,
    };

    // Simulate custom event from SendPaymentForm
    act(() => {
      window.dispatchEvent(
        new CustomEvent("finchippay:pending-tx", { detail: pendingTx })
      );
    });

    // Expect the pending badge and the transaction to appear
    expect(screen.getByText("Pending")).toBeInTheDocument();
    expect(screen.getByText("-10.0000000 XLM")).toBeInTheDocument();
  });

  it("strips out the pending entry if a simulated network submission failure occurs", async () => {
    render(<TransactionList publicKey="GBMOCK" />);

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const pendingTx: PaymentRecord = {
      id: "pending-123",
      type: "sent",
      amount: "10.0000000",
      asset: "XLM",
      from: "GBMOCK",
      to: "GDTEST",
      createdAt: new Date().toISOString(),
      transactionHash: "pending-123",
      isPending: true,
    };

    act(() => {
      window.dispatchEvent(
        new CustomEvent("finchippay:pending-tx", { detail: pendingTx })
      );
    });

    expect(screen.getByText("Pending")).toBeInTheDocument();

    // Simulate failure response
    act(() => {
      window.dispatchEvent(
        new CustomEvent("finchippay:failed-tx", { detail: { pendingId: "pending-123" } })
      );
    });

    // The pending transaction should be removed
    expect(screen.queryByText("Pending")).not.toBeInTheDocument();
    expect(screen.queryByText("-10.0000000 XLM")).not.toBeInTheDocument();
  });
});

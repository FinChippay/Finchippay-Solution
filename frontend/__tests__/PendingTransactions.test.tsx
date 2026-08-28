/**
 * __tests__/PendingTransactions.test.tsx
 * Component tests for the dashboard "Pending transactions" section, mocking the
 * useOfflineQueue hook so we can drive render/sync/remove/toast behaviour.
 */

import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import PendingTransactions from "@/components/PendingTransactions";
import { useOfflineQueue } from "@/lib/useOfflineQueue";
import { useToastContext } from "@/lib/ToastContext";

jest.mock("@/lib/useOfflineQueue", () => ({ useOfflineQueue: jest.fn() }));
jest.mock("@/lib/ToastContext", () => ({
  useToastContext: jest.fn(() => ({ addToast: jest.fn(), toasts: [], removeToast: jest.fn() })),
}));

const mockUseOfflineQueue = useOfflineQueue as jest.MockedFunction<typeof useOfflineQueue>;
const mockAddToast = jest.fn();

const baseHook = {
  transactions: [],
  pendingCount: 0,
  queueCount: 0,
  syncStatus: "online" as const,
  isOffline: false,
  processQueue: jest.fn().mockResolvedValue(undefined),
  removeTransaction: jest.fn().mockResolvedValue(undefined),
  refresh: jest.fn().mockResolvedValue(undefined),
};

const queuedTx = {
  id: "tx-1",
  signedXDR: "AAAA",
  destination: "GABCDEFGHIJKLMNOPQRSTUVWXYZ123456",
  amount: "10",
  asset: "XLM",
  createdAt: Date.now(),
  status: "queued" as const,
  attempts: 0,
};

const failedTx = {
  ...queuedTx,
  id: "tx-2",
  status: "failed" as const,
  error: "Network error",
};

beforeEach(() => {
  jest.clearAllMocks();
  (useToastContext as jest.Mock).mockReturnValue({ addToast: mockAddToast, toasts: [], removeToast: jest.fn() });
});

describe("PendingTransactions", () => {
  it("renders nothing when there are no pending transactions", () => {
    mockUseOfflineQueue.mockReturnValue(baseHook);
    const { container } = render(<PendingTransactions />);
    expect(container.firstChild).toBeNull();
  });

  it("renders queued transactions with their status", () => {
    mockUseOfflineQueue.mockReturnValue({
      ...baseHook,
      transactions: [queuedTx],
      pendingCount: 1,
      queueCount: 1,
      syncStatus: "queued",
    });
    render(<PendingTransactions />);
    expect(screen.getByText("Pending transactions")).toBeInTheDocument();
    expect(screen.getByText("10 XLM")).toBeInTheDocument();
    expect(screen.getByText("Queued")).toBeInTheDocument();
    expect(screen.getByText("Sync now")).toBeInTheDocument();
  });

  it("shows failed status with error and a Retry button", () => {
    mockUseOfflineQueue.mockReturnValue({
      ...baseHook,
      transactions: [failedTx],
      pendingCount: 1,
      queueCount: 1,
      syncStatus: "queued",
    });
    render(<PendingTransactions />);
    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(screen.getByText("Network error")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Retry"));
    expect(baseHook.processQueue).toHaveBeenCalled();
  });

  it("removes a transaction when Remove is clicked", () => {
    mockUseOfflineQueue.mockReturnValue({
      ...baseHook,
      transactions: [queuedTx],
      pendingCount: 1,
      queueCount: 1,
      syncStatus: "queued",
    });
    render(<PendingTransactions />);
    fireEvent.click(screen.getByLabelText(/Remove queued payment/));
    expect(baseHook.removeTransaction).toHaveBeenCalledWith("tx-1");
  });

  it("fires a toast when a brand-new queued transaction appears", () => {
    mockUseOfflineQueue.mockReturnValue({
      ...baseHook,
      transactions: [queuedTx],
      pendingCount: 1,
      queueCount: 1,
      syncStatus: "queued",
    });
    render(<PendingTransactions />);
    expect(mockAddToast).toHaveBeenCalledWith(
      "Transaction queued — will be sent when you're back online.",
      "info"
    );
  });
});

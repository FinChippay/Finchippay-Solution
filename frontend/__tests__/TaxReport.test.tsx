/**
 * __tests__/TaxReport.test.tsx
 * Unit tests for TaxReport (issue #605).
 */

import { render, screen, waitFor } from "@testing-library/react";
import TaxReport from "@/components/TaxReport";

jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en" },
  }),
}));

const mockPublicKey = { publicKey: null as string | null };
jest.mock("@/lib/useWallet", () => ({
  useWallet: () => ({ publicKey: mockPublicKey.publicKey }),
}));

const mockGetPaymentHistory = jest.fn();
jest.mock("@/lib/stellar", () => ({
  getPaymentHistory: (...args: unknown[]) => mockGetPaymentHistory(...args),
}));

jest.mock("@/lib/portfolio", () => {
  const actual = jest.requireActual("@/lib/portfolio");
  return {
    ...actual,
    fetchTokenPricesCached: jest.fn().mockResolvedValue({ prices: {}, stale: false }),
    fetchHistoricalPrices: jest.fn().mockResolvedValue({}),
  };
});

jest.mock("@/lib/exportTransactions", () => ({
  downloadCSV: jest.fn(),
}));

describe("TaxReport", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPublicKey.publicKey = null;
    mockGetPaymentHistory.mockReset();
  });

  it("prompts to connect a wallet when none is connected", () => {
    render(<TaxReport fiatCurrency="USD" />);
    expect(screen.getByText("dashboard.connectPrompt")).toBeInTheDocument();
  });

  it("shows an empty state when there is no transaction history", async () => {
    mockPublicKey.publicKey = "GABC";
    mockGetPaymentHistory.mockResolvedValue({ records: [], nextCursor: undefined });

    render(<TaxReport fiatCurrency="USD" />);
    await waitFor(() =>
      expect(screen.getByText("taxReport.noData")).toBeInTheDocument()
    );
  });

  it("renders a summary and per-asset rows when history exists", async () => {
    mockPublicKey.publicKey = "GABC";
    mockGetPaymentHistory.mockResolvedValue({
      records: [
        {
          id: "1",
          type: "received",
          amount: "10",
          asset: "XLM",
          from: "GOTHER",
          to: "GABC",
          createdAt: "2026-01-01T00:00:00Z",
          transactionHash: "abc",
          hash: "abc",
        },
      ],
      nextCursor: undefined,
    });

    render(<TaxReport fiatCurrency="USD" />);

    await waitFor(() =>
      expect(screen.getByText("taxReport.summary")).toBeInTheDocument()
    );
    // Asset row present
    expect(screen.getByText("XLM")).toBeInTheDocument();
    // Export button present
    expect(screen.getByText("taxReport.exportCSV")).toBeInTheDocument();
  });
});

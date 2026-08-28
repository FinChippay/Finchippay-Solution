/**
 * __tests__/PortfolioOverview.test.tsx
 * Unit tests for PortfolioOverview (issue #362).
 */

import { render, screen } from "@testing-library/react";
import PortfolioOverview from "@/components/PortfolioOverview";
import type { PortfolioToken, TokenPriceSnapshot } from "@/lib/portfolio";

jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en" },
  }),
}));

const holdings: PortfolioToken[] = [
  { code: "XLM", contractId: `C${"A".repeat(55)}`, balance: "100" },
  { code: "USDC", contractId: `C${"B".repeat(55)}`, balance: "50" },
];

const prices: Record<string, TokenPriceSnapshot> = {
  XLM: { prices: { USD: 0.1 }, change24hPct: { USD: 2.5 } },
  USDC: { prices: { USD: 1 }, change24hPct: { USD: -0.1 } },
};

describe("PortfolioOverview", () => {
  it("renders a loading skeleton while loading", () => {
    render(<PortfolioOverview holdings={[]} prices={{}} fiatCurrency="USD" loading />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("renders an empty state when there are no holdings", () => {
    render(<PortfolioOverview holdings={[]} prices={{}} fiatCurrency="USD" />);
    expect(screen.getByText("portfolio.noHoldings")).toBeInTheDocument();
  });

  it("renders the total value, 24h change, and a row per holding", () => {
    render(<PortfolioOverview holdings={holdings} prices={prices} fiatCurrency="USD" />);

    expect(screen.getByText("portfolio.totalValue")).toBeInTheDocument();
    expect(screen.getByText("portfolio.change24h")).toBeInTheDocument();
    expect(screen.getAllByText("XLM").length).toBeGreaterThan(0);
    expect(screen.getAllByText("USDC").length).toBeGreaterThan(0);
  });

  it("shows a graceful placeholder for a holding with no price data", () => {
    render(<PortfolioOverview holdings={holdings} prices={{}} fiatCurrency="USD" />);
    expect(screen.getAllByText("portfolio.priceUnavailable").length).toBe(holdings.length);
  });

  it("shows a truncated contract ID label for custom tokens instead of a code", () => {
    const customHolding: PortfolioToken[] = [
      { code: `C${"Z".repeat(55)}`, contractId: `C${"Z".repeat(55)}`, balance: "0", isCustom: true },
    ];
    render(<PortfolioOverview holdings={customHolding} prices={{}} fiatCurrency="USD" />);
    // shortenAddress truncates to "CZZZ...ZZZZ" rather than the full 56-char id
    expect(screen.queryByText(customHolding[0].code)).not.toBeInTheDocument();
  });
});

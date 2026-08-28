/**
 * __tests__/PortfolioAllocation.test.tsx
 * Unit tests for PortfolioAllocation (issue #362).
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PortfolioAllocation from "@/components/PortfolioAllocation";
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

describe("PortfolioAllocation", () => {
  it("renders a loading skeleton while loading", () => {
    render(<PortfolioAllocation holdings={[]} prices={{}} fiatCurrency="USD" loading />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("renders an empty state when no holding has a priced value", () => {
    render(<PortfolioAllocation holdings={holdings} prices={{}} fiatCurrency="USD" />);
    expect(screen.getByText("portfolio.noHoldings")).toBeInTheDocument();
  });

  it("renders a legend row per priced holding with its allocation percentage", () => {
    render(<PortfolioAllocation holdings={holdings} prices={prices} fiatCurrency="USD" />);

    // XLM: 100 * 0.1 = 10, USDC: 50 * 1 = 50, total = 60 -> XLM is 16.7%
    expect(screen.getByText("16.7%")).toBeInTheDocument();
    expect(screen.getByText("83.3%")).toBeInTheDocument();
  });

  it("calls onSelectToken when a legend row is clicked", async () => {
    const user = userEvent.setup();
    const onSelectToken = jest.fn();
    render(
      <PortfolioAllocation holdings={holdings} prices={prices} fiatCurrency="USD" onSelectToken={onSelectToken} />
    );

    await user.click(screen.getByRole("button", { name: /XLM/ }));

    expect(onSelectToken).toHaveBeenCalledWith("XLM");
  });
});

import type { Meta, StoryObj } from "@storybook/react";
import PortfolioOverview from "../components/PortfolioOverview";

const holdings = [
  { code: "XLM", contractId: "CA".padEnd(56, "A"), balance: "1250.5" },
  { code: "USDC", contractId: "CB".padEnd(56, "B"), balance: "500" },
];
const prices = {
  XLM: { prices: { USD: 0.11 }, change24hPct: { USD: 3.2 } },
  USDC: { prices: { USD: 1.0 }, change24hPct: { USD: 0.01 } },
};

const meta: Meta<typeof PortfolioOverview> = {
  title: "Components/PortfolioOverview",
  component: PortfolioOverview,
  tags: ["autodocs"],
  parameters: { layout: "padded" },
};
export default meta;
type Story = StoryObj<typeof PortfolioOverview>;

export const Default: Story = {
  args: { holdings, prices, fiatCurrency: "USD" },
};

export const Loading: Story = {
  args: { holdings: [], prices: {}, fiatCurrency: "USD", loading: true },
};

export const Empty: Story = {
  args: { holdings: [], prices: {}, fiatCurrency: "USD" },
};

export const PriceUnavailable: Story = {
  args: { holdings, prices: {}, fiatCurrency: "USD" },
};

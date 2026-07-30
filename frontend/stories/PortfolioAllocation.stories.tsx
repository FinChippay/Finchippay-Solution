import type { Meta, StoryObj } from "@storybook/react";
import PortfolioAllocation from "../components/PortfolioAllocation";

const holdings = [
  { code: "XLM", contractId: "CA".padEnd(56, "A"), balance: "1250.5" },
  { code: "USDC", contractId: "CB".padEnd(56, "B"), balance: "500" },
  { code: "AQUA", contractId: "CC".padEnd(56, "C"), balance: "10000" },
];
const prices = {
  XLM: { prices: { USD: 0.11 }, change24hPct: { USD: 3.2 } },
  USDC: { prices: { USD: 1.0 }, change24hPct: { USD: 0.01 } },
  AQUA: { prices: { USD: 0.003 }, change24hPct: { USD: -1.5 } },
};

const meta: Meta<typeof PortfolioAllocation> = {
  title: "Components/PortfolioAllocation",
  component: PortfolioAllocation,
  tags: ["autodocs"],
  parameters: { layout: "padded" },
};
export default meta;
type Story = StoryObj<typeof PortfolioAllocation>;

export const Default: Story = {
  args: { holdings, prices, fiatCurrency: "USD" },
};

export const Loading: Story = {
  args: { holdings: [], prices: {}, fiatCurrency: "USD", loading: true },
};

export const Empty: Story = {
  args: { holdings: [], prices: {}, fiatCurrency: "USD" },
};

export const WithSelection: Story = {
  args: { holdings, prices, fiatCurrency: "USD", selectedCode: "USDC" },
};

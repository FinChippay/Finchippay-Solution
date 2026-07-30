import type { Meta, StoryObj } from "@storybook/react";
import PortfolioHistoryChart from "../components/PortfolioHistoryChart";

function generateHistory(days: number) {
  const out = [];
  let value = 1000;

  for (let i = days; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    value += (Math.random() - 0.45) * 30;

    out.push({
      date: d.toISOString().slice(0, 10),
      totalValue: Math.max(value, 0),
    });
  }

  return out;
}

const meta: Meta<typeof PortfolioHistoryChart> = {
  title: "Components/PortfolioHistoryChart",
  component: PortfolioHistoryChart,
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
  },
};

export default meta;

type Story = StoryObj<typeof PortfolioHistoryChart>;

export const Default: Story = {
  args: {
    history: generateHistory(30),
    fiatCurrency: "USD",
  },
};

export const BuildingHistory: Story = {
  args: {
    history: generateHistory(1),
    fiatCurrency: "USD",
  },
};

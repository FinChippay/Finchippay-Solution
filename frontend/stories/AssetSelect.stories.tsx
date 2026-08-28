import type { Meta, StoryObj } from "@storybook/react";
import AssetSelect from "../components/AssetSelect";

const meta: Meta<typeof AssetSelect> = {
  title: "Components/AssetSelect",
  component: AssetSelect,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "Reusable asset selection control for money-movement flows. Normalises Stellar asset selection (code + issuer) into a single component so that send, batch, escrow and streaming forms can all pick SAC / classic assets consistently.",
      },
    },
  },
  argTypes: {
    onSelect: { action: "onSelect" },
    onAddTrustline: { action: "onAddTrustline" },
  },
};

export default meta;
type Story = StoryObj<typeof AssetSelect>;

const sampleOptions = [
  { code: "XLM", displayName: "XLM", isTrusted: true },
  { code: "USDC", displayName: "USDC", isTrusted: true, balance: "10.50" },
  { code: "EURT", displayName: "EURT", issuer: "GAP5...", issuerHint: "tempo.eu.com", isTrusted: false },
  { code: "NGNT", displayName: "NGNT", issuer: "GAWO...", issuerHint: "cowrie.exchange", isTrusted: true },
];

export const Default: Story = {
  args: {
    options: sampleOptions,
    selectedCode: "XLM",
  },
};

export const WithUntrustedAsset: Story = {
  args: {
    options: sampleOptions,
    selectedCode: "XLM",
    onAddTrustline: () => {},
  },
};

export const WithFiatPrices: Story = {
  args: {
    options: sampleOptions.map((o) => ({ ...o, balance: o.code === "XLM" ? "25" : o.balance })),
    selectedCode: "USDC",
    onAddTrustline: () => {},
    prices: { XLM: 0.09, USDC: 1, EURT: 1.08 },
  },
};

export const Empty: Story = {
  args: {
    options: [],
    selectedCode: "",
  },
};
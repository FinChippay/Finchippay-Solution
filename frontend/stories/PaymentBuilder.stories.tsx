import type { Meta, StoryObj } from "@storybook/react";
import PaymentBuilder from "../components/PaymentBuilder";

const PUBLIC_KEY = "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37";

const meta = {
  title: "Components/PaymentBuilder",
  component: PaymentBuilder,
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "Visual drag-and-drop payment builder with reordering, quick-add drop targets, and undo/redo support.",
      },
    },
  },
  args: {
    publicKey: PUBLIC_KEY,
  },
} satisfies Meta<typeof PaymentBuilder>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithRecipients: Story = {
  args: {
    initialRecipients: [
      {
        id: "rec-1",
        address: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
        amount: "50",
        memo: "Design work",
        token: { code: "XLM" },
      },
      {
        id: "rec-2",
        address: "GA2C5RFPE6GCKMY3US5PAB4UZLKIGF42QD2VXYL43AYVR2AKXT672LAE",
        amount: "100",
        memo: "Engineering sprint",
        token: { code: "USDC" },
      },
    ],
  },
};

import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, within } from "@storybook/test";
import MultiSigFlow from "../components/MultiSigFlow";

const PUBLIC_KEY = "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37";
const RECIPIENT = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

const meta = {
  title: "Components/MultiSigFlow",
  component: MultiSigFlow,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "Guides high-value Stellar payments through transaction building, initiator signing, co-signer collection, and submission.",
      },
    },
  },
  args: {
    publicKey: PUBLIC_KEY,
    xlmBalance: "1250.0000000",
    prefill: {
      destination: RECIPIENT,
      amount: "250",
      memo: "Treasury settlement",
    },
  },
} satisfies Meta<typeof MultiSigFlow>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Loading: Story = {
  args: {
    services: {
      buildPaymentTransaction: () => new Promise<never>(() => undefined),
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Build Transaction" }));
    await expect(canvas.getByRole("button", { name: "Building..." })).toBeDisabled();
  },
};

export const Error: Story = {
  args: {
    services: {
      buildPaymentTransaction: async () => {
        throw new globalThis.Error("Unable to load the source account from Stellar.");
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Build Transaction" }));
    await expect(
      await canvas.findByText("Unable to load the source account from Stellar.")
    ).toBeInTheDocument();
  },
};

export const Mobile: Story = {
  parameters: {
    viewport: { defaultViewport: "mobile1" },
    layout: "fullscreen",
  },
};

import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, within } from "@storybook/test";
import TipWidget from "../components/TipWidget";

const PUBLIC_KEY = "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37";
const DESTINATION = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

const meta = {
  title: "Components/TipWidget",
  component: TipWidget,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Public creator tipping experience with presets, custom XLM amounts, lazy wallet connection, and payment completion feedback.",
      },
    },
  },
  args: {
    creatorUsername: "finchippay",
    destination: DESTINATION,
    walletPublicKey: null,
  },
} satisfies Meta<typeof TipWidget>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Loading: Story = {
  args: {
    walletPublicKey: PUBLIC_KEY,
    loadBalance: () => new Promise<never>(() => undefined),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("Checking balance...")).toBeInTheDocument();
  },
};

export const Error: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const amount = canvas.getByLabelText("Custom amount");
    await userEvent.clear(amount);
    await userEvent.type(amount, "0");
    await expect(
      canvas.getByText("Enter at least 0.0000001 XLM to continue.")
    ).toBeInTheDocument();
  },
};

export const Mobile: Story = {
  parameters: {
    viewport: { defaultViewport: "mobile1" },
  },
};

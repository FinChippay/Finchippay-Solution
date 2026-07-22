import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, within } from "@storybook/test";
import EscrowPage from "../pages/escrow";

const PUBLIC_KEY = "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37";
const READY_SERVICES = {
  getXLMBalance: async () => "240.0000000",
  getCurrentLedger: async () => 12_345_678,
  getEscrow: async () => null,
};

const meta = {
  title: "Pages/EscrowPage",
  component: EscrowPage,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Creates time-locked Soroban escrows and lets senders or recipients look up, cancel, or claim existing records.",
      },
    },
  },
  args: {
    walletPublicKey: PUBLIC_KEY,
    services: READY_SERVICES,
  },
} satisfies Meta<typeof EscrowPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Loading: Story = {
  args: {
    services: {
      ...READY_SERVICES,
      getEscrow: () => new Promise<never>(() => undefined),
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByPlaceholderText("Escrow id"), "42");
    await userEvent.click(canvas.getByRole("button", { name: "Look up" }));
    await expect(canvas.getByRole("button", { name: "Looking up…" })).toBeDisabled();
  },
};

export const Error: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByPlaceholderText("Escrow id"), "-1");
    await userEvent.click(canvas.getByRole("button", { name: "Look up" }));
    await expect(canvas.getByText("Enter a non-negative escrow id.")).toBeInTheDocument();
  },
};

export const Mobile: Story = {
  parameters: {
    viewport: { defaultViewport: "mobile1" },
  },
};

import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, within } from "@storybook/test";
import BatchPaymentForm from "../components/BatchPaymentForm";

const PUBLIC_KEY = "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37";
const RECIPIENT = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

const meta = {
  title: "Components/BatchPaymentForm",
  component: BatchPaymentForm,
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "Builds and submits sequential XLM payments for up to ten recipients with per-row progress and retry feedback.",
      },
    },
  },
  args: {
    publicKey: PUBLIC_KEY,
    xlmBalance: "500.0000000",
  },
} satisfies Meta<typeof BatchPaymentForm>;

export default meta;
type Story = StoryObj<typeof meta>;

async function fillValidRecipient(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await userEvent.type(canvas.getByLabelText("Recipient address"), RECIPIENT);
  await userEvent.type(canvas.getByLabelText("Amount (XLM)"), "12.5");
  await userEvent.type(canvas.getByLabelText("Memo (optional)"), "Contractor payout");
  return canvas;
}

export const Default: Story = {
  play: async ({ canvasElement }) => {
    await fillValidRecipient(canvasElement);
  },
};

export const Loading: Story = {
  args: {
    services: {
      buildPaymentTransaction: () => new Promise<never>(() => undefined),
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = await fillValidRecipient(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Send batch" }));
    await expect(canvas.getByRole("button", { name: "Sending batch..." })).toBeDisabled();
    await expect(canvas.getByText("Processing")).toBeInTheDocument();
  },
};

export const Error: Story = {
  args: {
    services: {
      buildPaymentTransaction: async () => {
        throw new globalThis.Error("Stellar rejected this recipient payment.");
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = await fillValidRecipient(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Send batch" }));
    await expect(
      await canvas.findByText("Stellar rejected this recipient payment.")
    ).toBeInTheDocument();
  },
};

export const Mobile: Story = {
  parameters: {
    viewport: { defaultViewport: "mobile1" },
    layout: "fullscreen",
  },
  play: async ({ canvasElement }) => {
    await fillValidRecipient(canvasElement);
  },
};

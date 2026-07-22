import type { Meta, StoryObj } from "@storybook/react";
import { expect, fn, userEvent, within } from "@storybook/test";
import AIPaymentAssistant from "../components/AIPaymentAssistant";

const RECIPIENT = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

const meta = {
  title: "Components/AIPaymentAssistant",
  component: AIPaymentAssistant,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Parses natural-language payment requests into structured Stellar payment details and asks for clarification when needed.",
      },
    },
  },
  args: {
    isOpen: true,
    onClose: fn(),
    onConfirm: fn(),
  },
} satisfies Meta<typeof AIPaymentAssistant>;

export default meta;
type Story = StoryObj<typeof meta>;

function installFetch(implementation: () => Promise<Response>) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fn(implementation) as unknown as typeof fetch;
  return () => {
    globalThis.fetch = originalFetch;
  };
}

async function submitPrompt(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await userEvent.type(
    canvas.getByLabelText("Payment description"),
    `Send 50 XLM to ${RECIPIENT} for design work`
  );
  await userEvent.click(canvas.getByRole("button", { name: "Parse Payment" }));
  return canvas;
}

export const Default: Story = {
  beforeEach: () =>
    installFetch(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            amount: "50 XLM",
            recipient: RECIPIENT,
            memo: "design work",
            isValid: true,
            clarification: "",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      )
    ),
  play: async ({ canvasElement }) => {
    const canvas = await submitPrompt(canvasElement);
    await expect(await canvas.findByText("Parsed Payment Details")).toBeInTheDocument();
  },
};

export const Loading: Story = {
  beforeEach: () => installFetch(() => new Promise<Response>(() => undefined)),
  play: async ({ canvasElement }) => {
    const canvas = await submitPrompt(canvasElement);
    await expect(canvas.getByRole("button", { name: "Parsing..." })).toBeDisabled();
  },
};

export const Error: Story = {
  beforeEach: () =>
    installFetch(() => Promise.resolve(new Response(null, { status: 503 }))),
  play: async ({ canvasElement }) => {
    const canvas = await submitPrompt(canvasElement);
    await expect(
      await canvas.findByText("Failed to parse your request. Please try again.")
    ).toBeInTheDocument();
  },
};

export const Mobile: Story = {
  parameters: {
    viewport: { defaultViewport: "mobile1" },
  },
};

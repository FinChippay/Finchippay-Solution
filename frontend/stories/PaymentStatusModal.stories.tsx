import type { Meta, StoryObj } from "@storybook/react";
import { fn } from "@storybook/test";
import PaymentStatusModal, {
  type PaymentStepId,
  type PaymentStepTiming,
} from "../components/PaymentStatusModal";

const timing = (
  startedAt: number | null,
  completedAt: number | null,
  error: string | null = null
): PaymentStepTiming => ({ startedAt, completedAt, error });

const successTimings: Record<PaymentStepId, PaymentStepTiming> = {
  building: timing(1, 801),
  signing: timing(1001, 2401),
  submitting: timing(2601, 3501),
  confirming: timing(3701, 5801),
};

const meta = {
  title: "Components/PaymentStatusModal",
  component: PaymentStatusModal,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Tracks transaction building, signing, submission, and network confirmation with progress, timing, success, and failure feedback.",
      },
    },
  },
  args: {
    isOpen: true,
    onClose: fn(),
    timeoutSeconds: 60,
  },
} satisfies Meta<typeof PaymentStatusModal>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    status: "success",
    txHash: "7c9b5c9d8fa17944d10c6fc593340fee5efc70ab4f744f544bed395f61b6fb7a",
    error: null,
    failedStep: null,
    stepTimings: successTimings,
    explorerHref: "https://stellar.expert/explorer/testnet/tx/7c9b5c9d8fa1",
  },
};

export const Loading: Story = {
  args: {
    status: "confirming",
    txHash: null,
    error: null,
    failedStep: null,
    stepTimings: {
      building: timing(1, 801),
      signing: timing(1001, 2401),
      submitting: timing(2601, 3501),
      confirming: timing(null, null),
    },
  },
};

export const Error: Story = {
  args: {
    status: "error",
    txHash: null,
    error: "Horizon rejected the submitted transaction.",
    failedStep: "submitting",
    stepTimings: {
      building: timing(1, 801),
      signing: timing(1001, 2401),
      submitting: timing(2601, 3201, "Horizon rejected the submitted transaction."),
      confirming: timing(null, null),
    },
  },
};

export const Mobile: Story = {
  args: Default.args,
  parameters: {
    viewport: { defaultViewport: "mobile1" },
  },
};

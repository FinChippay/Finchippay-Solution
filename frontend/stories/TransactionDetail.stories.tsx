/**
 * stories/TransactionDetail.stories.tsx
 * Storybook stories for transaction detail components
 */

import type { Meta, StoryObj } from "@storybook/react";
import TransactionActions from "@/components/TransactionActions";
import TransactionTimeline from "@/components/TransactionTimeline";

const meta: Meta<typeof TransactionTimeline> = {
  title: "Components/TransactionTimeline",
  component: TransactionTimeline,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof TransactionTimeline>;

export const AllCompleted: Story = {
  args: {
    steps: [
      { label: "Created", timestamp: "2024-01-01T00:00:00Z", status: "completed" },
      { label: "Signed", timestamp: "2024-01-01T00:00:01Z", status: "completed" },
      { label: "Submitted", timestamp: "2024-01-01T00:00:02Z", status: "completed" },
      { label: "Confirmed", timestamp: "2024-01-01T00:00:03Z", status: "completed" },
    ],
  },
};

export const InProgress: Story = {
  args: {
    steps: [
      { label: "Created", timestamp: "2024-01-01T00:00:00Z", status: "completed" },
      { label: "Signed", timestamp: "2024-01-01T00:00:01Z", status: "completed" },
      { label: "Submitted", status: "current" },
      { label: "Confirmed", status: "pending" },
    ],
  },
};

export const Failed: Story = {
  args: {
    steps: [
      { label: "Created", timestamp: "2024-01-01T00:00:00Z", status: "completed" },
      { label: "Signed", timestamp: "2024-01-01T00:00:01Z", status: "completed" },
      { label: "Submitted", timestamp: "2024-01-01T00:00:02Z", status: "completed" },
      { label: "Failed", timestamp: "2024-01-01T00:00:03Z", status: "completed" },
    ],
  },
};

// Transaction Actions Stories
const actionsMeta: Meta<typeof TransactionActions> = {
  title: "Components/TransactionActions",
  component: TransactionActions,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
};

export const ActionsDefault: StoryObj<typeof TransactionActions> = {
  args: {
    transactionHash: "abc123def456789",
    transaction: {
      hash: "abc123def456789",
      ledger: 12345,
      createdAt: "2024-01-01T00:00:00Z",
      sourceAccount: "GABC123",
      fee: "0.00001",
      successful: true,
    },
  },
};

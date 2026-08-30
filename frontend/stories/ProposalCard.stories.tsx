import type { Meta, StoryObj } from "@storybook/react";
import type { TreasuryProposal } from "@/lib/treasury";
import ProposalCard from "../components/ProposalCard";

const PUBLIC_KEY = "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37";

const adminProposal: TreasuryProposal = {
  kind: "admin",
  id: 2,
  proposer: PUBLIC_KEY,
  actionType: "pause",
  actionData: [],
  approvals: [PUBLIC_KEY],
  signers: [PUBLIC_KEY, "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"],
  threshold: 2,
  status: "pending",
  rawStatus: "Pending",
  expirationLedger: 120960,
  raw: {} as never,
};

const meta = {
  title: "Treasury/ProposalCard",
  component: ProposalCard,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "Compact treasury row showing governance or payment multi-sig proposal kind, action, approval progress and status.",
      },
    },
  },
  args: {
    proposal: adminProposal,
    onSelect: () => {},
  },
} satisfies Meta<typeof ProposalCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const PendingAdmin: Story = {};

export const Executed: Story = {
  args: {
    proposal: {
      ...adminProposal,
      status: "executed",
      rawStatus: "Executed",
      approvals: [PUBLIC_KEY, "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"],
    },
  },
};

export const Payment: Story = {
  args: {
    proposal: {
      ...adminProposal,
      kind: "payment",
      actionType: "payment",
      signers: [PUBLIC_KEY, "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"],
      approvals: [PUBLIC_KEY],
    },
  },
};

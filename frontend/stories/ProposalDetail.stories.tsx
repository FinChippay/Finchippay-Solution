import type { Meta, StoryObj } from "@storybook/react";
import type { TreasuryProposal } from "@/lib/treasury";
import ProposalDetail from "../components/ProposalDetail";

const PUBLIC_KEY = "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37";

const adminProposal: TreasuryProposal = {
  kind: "admin",
  id: 2,
  proposer: PUBLIC_KEY,
  actionType: "set_admin_signers",
  actionData: [[PUBLIC_KEY, "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"], 2],
  approvals: [PUBLIC_KEY],
  signers: [PUBLIC_KEY, "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"],
  threshold: 2,
  status: "pending",
  rawStatus: "Pending",
  expirationLedger: 120960,
  raw: {} as never,
};

const meta = {
  title: "Treasury/ProposalDetail",
  component: ProposalDetail,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "Full detail view for a governance or payment multi-sig proposal, with signer list and wallet-backed approve action.",
      },
    },
  },
  args: {
    proposal: adminProposal,
    publicKey: PUBLIC_KEY,
    onBack: () => {},
    onApproved: () => {},
  },
} satisfies Meta<typeof ProposalDetail>;

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

export const NoWallet: Story = {
  args: {
    publicKey: null,
  },
};

export const Payment: Story = {
  args: {
    proposal: {
      ...adminProposal,
      kind: "payment",
      actionType: "payment",
      actionData: [],
    },
  },
};

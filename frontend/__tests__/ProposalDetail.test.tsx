/**
 * __tests__/ProposalDetail.test.tsx
 * Unit tests for the ProposalDetail treasury view.
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import type { TreasuryProposal } from "@/lib/treasury";
import ProposalDetail from "../components/ProposalDetail";

const mockBuildAdmin = jest.fn();
const mockBuildPayment = jest.fn();
const mockSign = jest.fn();
const mockSubmit = jest.fn();

jest.mock("@/lib/soroban", () => ({
  getClient: () => ({
    buildApproveAdminActionTx: (...args: unknown[]) => mockBuildAdmin(...args),
    buildApprovePaymentMultisigTx: (...args: unknown[]) => mockBuildPayment(...args),
  }),
}));

jest.mock("@/lib/wallet", () => ({
  signTransactionWithWallet: (...args: unknown[]) => mockSign(...args),
}));

jest.mock("@/lib/stellar", () => ({
  submitTransaction: (...args: unknown[]) => mockSubmit(...args),
}));

const PUBLIC_KEY = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

const adminProposal: TreasuryProposal = {
  kind: "admin",
  id: 2,
  proposer: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  actionType: "set_admin_signers",
  actionData: [["GAAA", "GBBB", "GCCC"], 2],
  approvals: ["GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"],
  signers: ["GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"],
  threshold: 3,
  status: "pending",
  rawStatus: "Pending",
  expirationLedger: 120960,
  raw: {} as never,
};

describe("ProposalDetail", () => {
  const onBack = jest.fn();
  const onApproved = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders detail fields for an admin proposal", () => {
    render(
      <ProposalDetail proposal={adminProposal} publicKey={PUBLIC_KEY} onBack={onBack} onApproved={onApproved} />,
    );
    expect(screen.getByText("Update Admin Signers")).toBeInTheDocument();
    expect(screen.getByText("set_admin_signers")).toBeInTheDocument();
    expect(screen.getByText(/Signers: 3/)).toBeInTheDocument();
    expect(screen.getByText("1 of 3")).toBeInTheDocument();
  });

  it("shows back button calling onBack", async () => {
    const user = userEvent.setup();
    render(
      <ProposalDetail proposal={adminProposal} publicKey={PUBLIC_KEY} onBack={onBack} onApproved={onApproved} />,
    );
    await user.click(screen.getByRole("button", { name: /Back to proposals/i }));
    expect(onBack).toHaveBeenCalled();
  });

  it("approves an admin action through the wallet when connected", async () => {
    const user = userEvent.setup();
    mockBuildAdmin.mockResolvedValue({ toXDR: () => "mock-xdr" });
    mockSign.mockResolvedValue({ signedXDR: "signed-xdr", error: null });
    mockSubmit.mockResolvedValue({ hash: "0xabc" });

    render(
      <ProposalDetail proposal={adminProposal} publicKey={PUBLIC_KEY} onBack={onBack} onApproved={onApproved} />,
    );

    await user.click(screen.getByRole("button", { name: /Approve/i }));

    expect(mockBuildAdmin).toHaveBeenCalledWith(2, PUBLIC_KEY);
    expect(mockSign).toHaveBeenCalledWith("mock-xdr");
    expect(mockSubmit).toHaveBeenCalledWith("signed-xdr");
    expect(onApproved).toHaveBeenCalled();
    expect(await screen.findByText(/Approved — tx 0xabc/i)).toBeInTheDocument();
  });

  it("prompts to connect a wallet when not connected", () => {
    render(
      <ProposalDetail proposal={adminProposal} publicKey={null} onBack={onBack} onApproved={onApproved} />,
    );
    expect(screen.getByText(/Connect a wallet to approve/i)).toBeInTheDocument();
  });

  it("disables the approve button for executed proposals", () => {
    const executed = { ...adminProposal, status: "executed" as const };
    render(
      <ProposalDetail proposal={executed} publicKey={PUBLIC_KEY} onBack={onBack} onApproved={onApproved} />,
    );
    expect(screen.getByRole("button", { name: /Approve/i })).toBeDisabled();
  });

  it("renders a payment proposal with raw payload placeholder", () => {
    const payment: TreasuryProposal = {
      ...adminProposal,
      kind: "payment",
      actionType: "payment",
      actionData: [],
      signers: ["GAAA", "GBBB"],
      approvals: ["GAAA"],
      threshold: 2,
    };
    render(
      <ProposalDetail proposal={payment} publicKey={PUBLIC_KEY} onBack={onBack} onApproved={onApproved} />,
    );
    expect(screen.getByText("Payment multi-sig")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});

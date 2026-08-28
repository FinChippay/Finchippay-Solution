/**
 * __tests__/ProposalCard.test.tsx
 * Unit tests for the ProposalCard treasury row.
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import type { TreasuryProposal } from "@/lib/treasury";
import ProposalCard from "../components/ProposalCard";

const baseAdmin: TreasuryProposal = {
  kind: "admin",
  id: 2,
  proposer: "GAAA",
  actionType: "pause",
  actionData: [],
  approvals: ["GAAA", "GBBB"],
  signers: ["GAAA", "GBBB", "GCCC"],
  threshold: 3,
  status: "pending",
  rawStatus: "Pending",
  expirationLedger: 120960,
  raw: {} as never,
};

describe("ProposalCard", () => {
  it("renders governance proposal with kind, id and status", () => {
    render(<ProposalCard proposal={baseAdmin} onSelect={() => {}} />);
    expect(screen.getByText("Governance")).toBeInTheDocument();
    expect(screen.getByText("#2")).toBeInTheDocument();
    expect(screen.getByText("Pause Contract")).toBeInTheDocument();
    expect(screen.getByText("pending")).toBeInTheDocument();
  });

  it("shows approval progress text", () => {
    render(<ProposalCard proposal={baseAdmin} onSelect={() => {}} />);
    expect(screen.getByText("2 of 3 signed")).toBeInTheDocument();
  });

  it("calls onSelect on click", async () => {
    const user = userEvent.setup();
    const onSelect = jest.fn();
    render(<ProposalCard proposal={baseAdmin} onSelect={onSelect} />);
    await user.click(screen.getByRole("button", { name: /Pause Contract proposal 2/i }));
    expect(onSelect).toHaveBeenCalledWith(baseAdmin);
  });

  it("renders executed status without progress text", () => {
    const executed = { ...baseAdmin, status: "executed" as const, approvals: ["GAAA", "GBBB", "GCCC"] };
    render(<ProposalCard proposal={executed} onSelect={() => {}} />);
    expect(screen.getByText("Executed")).toBeInTheDocument();
  });

  it("renders a payment proposal with the payment badge", () => {
    const payment: TreasuryProposal = {
      ...baseAdmin,
      kind: "payment",
      actionType: "payment",
      signers: ["GAAA", "GBBB"],
      approvals: ["GAAA"],
      threshold: 2,
    };
    render(<ProposalCard proposal={payment} onSelect={() => {}} />);
    expect(screen.getAllByText("Payment").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Payment", { selector: "h3" })).toBeInTheDocument();
  });
});

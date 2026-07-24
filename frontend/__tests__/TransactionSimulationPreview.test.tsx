import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import TransactionSimulationPreview from "@/components/TransactionSimulationPreview";
import type { SimulationResult } from "@/hooks/useTransactionSimulation";

const mockSimulation: SimulationResult = {
  success: true,
  balanceChanges: [
    {
      asset: "native",
      assetCode: "XLM",
      before: "100.0000000",
      after: "95.0000000",
      difference: "-5.0000000",
    },
  ],
  resourceFee: {
    stroops: BigInt(100000),
    xlm: 0.01,
  },
  contractError: null,
  rawSimulation: {} as any,
  transactionXdr: "AAAAAgAAAAD...",
  preparedTransactionXdr: null,
};

const mockSimulationWithError: SimulationResult = {
  ...mockSimulation,
  success: false,
  contractError: { message: "release_ledger not reached" },
  balanceChanges: [],
  resourceFee: null,
};

describe("TransactionSimulationPreview", () => {
  it("renders nothing when closed", () => {
    const { container } = render(
      <TransactionSimulationPreview
        isOpen={false}
        onClose={jest.fn()}
        onProceed={jest.fn()}
        simulation={null}
        loading={false}
        error={null}
        warning={null}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it("shows balance changes with before/after amounts", () => {
    render(
      <TransactionSimulationPreview
        isOpen={true}
        onClose={jest.fn()}
        onProceed={jest.fn()}
        simulation={mockSimulation}
        loading={false}
        error={null}
        warning={null}
      />
    );
    expect(screen.getByText("Balance Changes")).toBeInTheDocument();
    expect(screen.getByText("Before: 100.0000000")).toBeInTheDocument();
    expect(screen.getByText("After: 95.0000000")).toBeInTheDocument();
    expect(screen.getByText("-5.0000000 XLM")).toBeInTheDocument();
  });

  it("shows resource fees in XLM", () => {
    render(
      <TransactionSimulationPreview
        isOpen={true}
        onClose={jest.fn()}
        onProceed={jest.fn()}
        simulation={mockSimulation}
        loading={false}
        error={null}
        warning={null}
      />
    );
    expect(screen.getByText("Resource Fees (Soroban)")).toBeInTheDocument();
    expect(screen.getByText("0.0100000 XLM")).toBeInTheDocument();
    expect(screen.getByText("(100,000 stroops)")).toBeInTheDocument();
  });

  it("surfaces contract errors before signing", () => {
    render(
      <TransactionSimulationPreview
        isOpen={true}
        onClose={jest.fn()}
        onProceed={jest.fn()}
        simulation={mockSimulationWithError}
        loading={false}
        error={null}
        warning="Simulation warning: release_ledger not reached"
      />
    );
    expect(screen.getByText("Contract Feedback")).toBeInTheDocument();
    expect(screen.getByText("release_ledger not reached")).toBeInTheDocument();
  });

  it("shows warning when simulation fails but allows proceeding", () => {
    const onProceed = jest.fn();
    render(
      <TransactionSimulationPreview
        isOpen={true}
        onClose={jest.fn()}
        onProceed={onProceed}
        simulation={mockSimulationWithError}
        loading={false}
        error={null}
        warning="Simulation warning: release_ledger not reached"
      />
    );
    expect(screen.getByText("Simulation Warning")).toBeInTheDocument();
    // Checkbox must be checked to proceed
    const checkbox = screen.getByRole("checkbox");
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByText("Proceed to Sign"));
    expect(onProceed).toHaveBeenCalled();
  });

  it("shows loading state during simulation", () => {
    render(
      <TransactionSimulationPreview
        isOpen={true}
        onClose={jest.fn()}
        onProceed={jest.fn()}
        simulation={null}
        loading={true}
        error={null}
        warning={null}
      />
    );
    expect(screen.getByText(/Simulating transaction/)).toBeInTheDocument();
  });

  it("shows success indicator when no errors", () => {
    render(
      <TransactionSimulationPreview
        isOpen={true}
        onClose={jest.fn()}
        onProceed={jest.fn()}
        simulation={mockSimulation}
        loading={false}
        error={null}
        warning={null}
      />
    );
    expect(screen.getByText(/Simulation passed/)).toBeInTheDocument();
  });

  it("shows error state for network failures", () => {
    render(
      <TransactionSimulationPreview
        isOpen={true}
        onClose={jest.fn()}
        onProceed={jest.fn()}
        simulation={null}
        loading={false}
        error="RPC connection failed"
        warning="Could not simulate."
      />
    );
    expect(screen.getByText("Simulation Error")).toBeInTheDocument();
    expect(screen.getByText("RPC connection failed")).toBeInTheDocument();
  });
});

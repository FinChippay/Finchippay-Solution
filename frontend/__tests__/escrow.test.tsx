import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Mock dependencies before importing EscrowPage
jest.mock("next/head", () => {
  return {
    __esModule: true,
    default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  };
});

jest.mock("@/lib/useWallet", () => ({
  useWallet: jest.fn(),
}));

jest.mock("@/components/WalletConnect", () => ({
  __esModule: true,
  default: () => <div data-testid="wallet-connect">WalletConnect Component</div>,
}));

jest.mock("@/lib/stellar", () => ({
  buildCreateEscrowTransaction: jest.fn(),
  buildClaimEscrowTransaction: jest.fn(),
  buildCancelEscrowTransaction: jest.fn(),
  getEscrow: jest.fn(),
  getCurrentLedger: jest.fn(),
  submitTransaction: jest.fn(),
  isValidStellarAddress: jest.fn((addr: string) => addr?.startsWith("G") && addr.length === 56),
  getXLMBalance: jest.fn(),
  CONTRACT_ID: "CCONTRACT123456789",
}));

jest.mock("@/lib/wallet", () => ({
  signTransactionWithWallet: jest.fn(),
}));

import EscrowPage from "../pages/escrow";
import { useWallet } from "@/lib/useWallet";
import * as stellarModule from "@/lib/stellar";
import * as walletModule from "@/lib/wallet";

const mockUseWallet = useWallet as jest.Mock;
const mockGetCurrentLedger = stellarModule.getCurrentLedger as jest.Mock;
const mockGetXLMBalance = stellarModule.getXLMBalance as jest.Mock;
const mockGetEscrow = stellarModule.getEscrow as jest.Mock;
const mockBuildCreateEscrowTransaction = stellarModule.buildCreateEscrowTransaction as jest.Mock;
const mockBuildClaimEscrowTransaction = stellarModule.buildClaimEscrowTransaction as jest.Mock;
const mockBuildCancelEscrowTransaction = stellarModule.buildCancelEscrowTransaction as jest.Mock;
const mockSubmitTransaction = stellarModule.submitTransaction as jest.Mock;
const mockSignTransactionWithWallet = walletModule.signTransactionWithWallet as jest.Mock;

describe("EscrowPage", () => {
  const senderPublicKey = "GBRPYHIL2CI3WHZDTOOQFC6EB4RRJC3D5NZ2KMSUGSRNVO7ZFGIGSZ";
  const recipientPublicKey = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

  beforeEach(() => {
    jest.clearAllMocks();
    mockUseWallet.mockReturnValue({ publicKey: senderPublicKey });
    mockGetXLMBalance.mockResolvedValue("100.0");
    mockGetCurrentLedger.mockResolvedValue(1000);
    mockBuildCreateEscrowTransaction.mockResolvedValue({ toXDR: () => "mock-tx-xdr" });
    mockBuildClaimEscrowTransaction.mockResolvedValue({ toXDR: () => "mock-claim-xdr" });
    mockBuildCancelEscrowTransaction.mockResolvedValue({ toXDR: () => "mock-cancel-xdr" });
    mockSignTransactionWithWallet.mockResolvedValue({ signedXDR: "mock-signed-xdr" });
    mockSubmitTransaction.mockResolvedValue({ returnValue: 42 });
  });

  it("renders WalletConnect component when user is not connected", () => {
    mockUseWallet.mockReturnValue({ publicKey: null });
    render(<EscrowPage />);

    expect(screen.getByTestId("wallet-connect")).toBeInTheDocument();
    expect(screen.queryByText("Create escrow")).not.toBeInTheDocument();
  });

  it("Create escrow form validates release date must be in the future (greater than current ledger)", async () => {
    const user = userEvent.setup();
    render(<EscrowPage />);

    await waitFor(() => {
      expect(screen.getByText(/Current ledger: 1,000/i)).toBeInTheDocument();
    });

    const recipientInput = screen.getByLabelText(/Recipient address/i);
    const amountInput = screen.getByLabelText(/Amount \(XLM\)/i);
    const ledgerInput = screen.getByLabelText(/Release ledger/i);
    const submitBtn = screen.getByRole("button", { name: /Lock funds in escrow/i });

    await user.type(recipientInput, recipientPublicKey);
    await user.type(amountInput, "50");

    // Enter release ledger equal to or less than current ledger (1000)
    await user.type(ledgerInput, "950");

    expect(screen.getByText("Release ledger must be greater than current ledger.")).toBeInTheDocument();
    expect(submitBtn).toBeDisabled();

    // Fix release ledger to a future value (1500)
    await user.clear(ledgerInput);
    await user.type(ledgerInput, "1500");

    expect(screen.queryByText("Release ledger must be greater than current ledger.")).not.toBeInTheDocument();
    expect(submitBtn).toBeEnabled();
  });

  it("validates self-transfer recipient", async () => {
    const user = userEvent.setup();
    render(<EscrowPage />);

    const recipientInput = screen.getByLabelText(/Recipient address/i);
    await user.type(recipientInput, senderPublicKey);

    expect(screen.getByText("Self-transfer is not allowed.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Lock funds in escrow/i })).toBeDisabled();
  });

  it("creates an escrow transaction when form is valid", async () => {
    const user = userEvent.setup();
    render(<EscrowPage />);

    await waitFor(() => {
      expect(mockGetCurrentLedger).toHaveBeenCalled();
    });

    await user.type(screen.getByLabelText(/Recipient address/i), recipientPublicKey);
    await user.type(screen.getByLabelText(/Amount \(XLM\)/i), "25");
    await user.type(screen.getByLabelText(/Release ledger/i), "1200");

    const submitBtn = screen.getByRole("button", { name: /Lock funds in escrow/i });
    expect(submitBtn).toBeEnabled();

    await user.click(submitBtn);

    await waitFor(() => {
      expect(mockBuildCreateEscrowTransaction).toHaveBeenCalledWith({
        fromPublicKey: senderPublicKey,
        toPublicKey: recipientPublicKey,
        amount: "25",
        releaseLedger: 1200,
      });
      expect(mockSignTransactionWithWallet).toHaveBeenCalled();
      expect(mockSubmitTransaction).toHaveBeenCalledWith("mock-signed-xdr");
      expect(screen.getByText(/Escrow created/i)).toBeInTheDocument();
    });
  });

  it("Active escrow list renders claim/cancel buttons based on state", async () => {
    const user = userEvent.setup();
    mockGetEscrow.mockResolvedValue({
      id: 42,
      from: senderPublicKey,
      to: recipientPublicKey,
      amount: "500000000",
      releaseLedger: 1500,
      status: "Pending",
    });

    render(<EscrowPage />);

    const lookupInput = screen.getByPlaceholderText("Escrow id");
    await user.type(lookupInput, "42");
    await user.click(screen.getByRole("button", { name: /Look up/i }));

    await waitFor(() => {
      expect(screen.getByText("Pending")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /^Claim$/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /^Cancel$/i })).toBeInTheDocument();
    });
  });

  it("Claim button disabled before release ledger", async () => {
    const user = userEvent.setup();
    // User is recipient, current ledger is 1000, release ledger is 1500 (future)
    mockUseWallet.mockReturnValue({ publicKey: recipientPublicKey });
    mockGetEscrow.mockResolvedValue({
      id: 42,
      from: senderPublicKey,
      to: recipientPublicKey,
      amount: "500000000",
      releaseLedger: 1500,
      status: "Pending",
    });

    render(<EscrowPage />);

    await user.type(screen.getByPlaceholderText("Escrow id"), "42");
    await user.click(screen.getByRole("button", { name: /Look up/i }));

    await waitFor(() => {
      const claimBtn = screen.getByRole("button", { name: /^Claim$/i });
      expect(claimBtn).toBeDisabled();
      expect(claimBtn).toHaveAttribute("title", "Release ledger not reached");
    });
  });

  it("Claim button enabled when release ledger is reached", async () => {
    const user = userEvent.setup();
    // User is recipient, current ledger is 1000, release ledger is 900 (past)
    mockUseWallet.mockReturnValue({ publicKey: recipientPublicKey });
    mockGetEscrow.mockResolvedValue({
      id: 42,
      from: senderPublicKey,
      to: recipientPublicKey,
      amount: "500000000",
      releaseLedger: 900,
      status: "Pending",
    });

    render(<EscrowPage />);

    await user.type(screen.getByPlaceholderText("Escrow id"), "42");
    await user.click(screen.getByRole("button", { name: /Look up/i }));

    await waitFor(() => {
      const claimBtn = screen.getByRole("button", { name: /^Claim$/i });
      expect(claimBtn).toBeEnabled();
    });
  });

  it("Cancel button triggers confirmation dialog and submits cancellation", async () => {
    const user = userEvent.setup();
    mockGetEscrow.mockResolvedValue({
      id: 42,
      from: senderPublicKey,
      to: recipientPublicKey,
      amount: "500000000",
      releaseLedger: 1500,
      status: "Pending",
    });

    const confirmSpy = jest.spyOn(window, "confirm").mockReturnValue(true);

    render(<EscrowPage />);

    await user.type(screen.getByPlaceholderText("Escrow id"), "42");
    await user.click(screen.getByRole("button", { name: /Look up/i }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /^Cancel$/i })).toBeEnabled();
    });

    await user.click(screen.getByRole("button", { name: /^Cancel$/i }));

    expect(confirmSpy).toHaveBeenCalledWith("Are you sure you want to cancel this escrow?");
    await waitFor(() => {
      expect(mockBuildCancelEscrowTransaction).toHaveBeenCalledWith(senderPublicKey, 42);
      expect(mockSubmitTransaction).toHaveBeenCalled();
    });

    confirmSpy.mockRestore();
  });

  it("Cancel button aborts if user rejects confirmation dialog", async () => {
    const user = userEvent.setup();
    mockGetEscrow.mockResolvedValue({
      id: 42,
      from: senderPublicKey,
      to: recipientPublicKey,
      amount: "500000000",
      releaseLedger: 1500,
      status: "Pending",
    });

    const confirmSpy = jest.spyOn(window, "confirm").mockReturnValue(false);

    render(<EscrowPage />);

    await user.type(screen.getByPlaceholderText("Escrow id"), "42");
    await user.click(screen.getByRole("button", { name: /Look up/i }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /^Cancel$/i })).toBeEnabled();
    });

    await user.click(screen.getByRole("button", { name: /^Cancel$/i }));

    expect(confirmSpy).toHaveBeenCalled();
    expect(mockBuildCancelEscrowTransaction).not.toHaveBeenCalled();

    confirmSpy.mockRestore();
  });
});

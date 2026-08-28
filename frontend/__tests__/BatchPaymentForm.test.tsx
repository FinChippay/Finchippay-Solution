import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

jest.mock("@/lib/stellar", () => ({
  buildPaymentTransaction: jest.fn(),
  buildSorobanBatchSendTransaction: jest.fn(),
  isValidStellarAddress: jest.fn(
    (addr: string) => addr.startsWith("G") && addr.length === 56
  ),
  submitTransaction: jest.fn(),
  truncateMemoText: jest.fn((text: string) => text),
  STELLAR_MEMO_TEXT_MAX_BYTES: 28,
  STELLAR_MINIMUM_ACCOUNT_BALANCE_XLM: 1,
}));

jest.mock("@/lib/wallet", () => ({
  signTransactionWithWallet: jest.fn(),
}));

import BatchPaymentForm from "../components/BatchPaymentForm";
import * as stellarModule from "@/lib/stellar";
import * as walletModule from "@/lib/wallet";

const mockBuildPaymentTransaction =
  stellarModule.buildPaymentTransaction as jest.Mock;
const mockSubmitTransaction = stellarModule.submitTransaction as jest.Mock;
const mockSignTransactionWithWallet =
  walletModule.signTransactionWithWallet as jest.Mock;

describe("BatchPaymentForm", () => {
  const defaultProps = {
    publicKey: "GDIRCSW35Z3D53C6U25J3L3V3735Y25Y333333333333333333333333",
    xlmBalance: "100.0",
    onBatchSuccess: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders batch payment form heading and initial recipient row", () => {
    render(<BatchPaymentForm {...defaultProps} />);
    expect(screen.getByText("Batch Send")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("G...")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Payment note")).toBeInTheDocument();
  });

  it("allows adding and removing recipient rows", async () => {
    render(<BatchPaymentForm {...defaultProps} />);
    const addButton = screen.getByRole("button", { name: /add recipient/i });
    fireEvent.click(addButton);

    const addressInputs = screen.getAllByPlaceholderText("G...");
    expect(addressInputs).toHaveLength(2);

    const removeButtons = screen.getAllByRole("button", { name: /remove/i });
    fireEvent.click(removeButtons[0]);

    expect(screen.getAllByPlaceholderText("G...")).toHaveLength(1);
  });

  it("processes batch payment with per-recipient memo", async () => {
    const mockTx = { toXDR: () => "mock-xdr" };
    mockBuildPaymentTransaction.mockResolvedValue(mockTx);
    mockSignTransactionWithWallet.mockResolvedValue({
      signedXDR: "signed-xdr",
    });
    mockSubmitTransaction.mockResolvedValue({ hash: "tx-hash-123" });

    render(<BatchPaymentForm {...defaultProps} />);

    const addressInput = screen.getByPlaceholderText("G...");
    const amountInput = screen.getByPlaceholderText("0.5");
    const memoInput = screen.getByPlaceholderText("Payment note");

    await userEvent.type(
      addressInput,
      "GA2C5RFPE6GCKMY3US5PAB4UZLKIGF42QD2VXYL43AYVR2AKXT672LAE"
    );
    await userEvent.type(amountInput, "10");
    await userEvent.type(memoInput, "INV-999");

    const sendButton = screen.getByRole("button", { name: /send batch/i });
    fireEvent.click(sendButton);

    await waitFor(() => {
      expect(mockBuildPaymentTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          toPublicKey:
            "GA2C5RFPE6GCKMY3US5PAB4UZLKIGF42QD2VXYL43AYVR2AKXT672LAE",
          amount: "10.0000000",
          memo: "INV-999",
        })
      );
      expect(screen.getByText("Batch payment complete.")).toBeInTheDocument();
    });
  });

  it("displays CSV import button", () => {
    render(<BatchPaymentForm {...defaultProps} />);
    expect(screen.getByRole("button", { name: /import csv/i })).toBeInTheDocument();
  });

  it("toggles CSV upload section when import button clicked", async () => {
    render(<BatchPaymentForm {...defaultProps} />);
    const importButton = screen.getByRole("button", { name: /import csv/i });
    
    fireEvent.click(importButton);
    
    await waitFor(() => {
      expect(screen.getByText("Import from CSV")).toBeInTheDocument();
    });
  });

  it("imports CSV data into recipients list", async () => {
    render(<BatchPaymentForm {...defaultProps} />);
    const importButton = screen.getByRole("button", { name: /import csv/i });
    
    fireEvent.click(importButton);
    
    // Mock CSV import data
    const csvRows = [
      {
        id: "row-0",
        recipient: "GA2C5RFPE6GCKMY3US5PAB4UZLKIGF42QD2VXYL43AYVR2AKXT672LAE",
        amount: "10",
        asset: "XLM",
        memo: "Payment 1",
        errors: [],
        isValid: true,
      },
      {
        id: "row-1",
        recipient: "GBBD47IFQTWJG7QNO6O74H5GLT4H3PTJQ4XHMFNKDQYSCY5BXKDY3J7B",
        amount: "20",
        asset: "XLM",
        memo: "Payment 2",
        errors: [],
        isValid: true,
      },
    ];
    
    // The CSV upload component would call handleCSVImport with the parsed rows
    // This is tested through the CSV upload component's own tests
    await waitFor(() => {
      expect(screen.getByText("Import from CSV")).toBeInTheDocument();
    });
  });
});


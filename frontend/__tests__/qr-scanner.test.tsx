import React from "react";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockDecodeFromConstraints = jest.fn();
const mockStop = jest.fn();
const mockScannerControls = { stop: mockStop };

jest.mock("@zxing/browser", () => ({
  BrowserQRCodeReader: jest.fn().mockImplementation(() => ({
    decodeFromConstraints: mockDecodeFromConstraints,
  })),
}));

jest.mock("@/lib/stellar", () => ({
  buildPaymentTransaction: jest.fn(),
  buildSorobanTipTransaction: jest.fn(),
  buildReceiptMintTransaction: jest.fn(),
  CONTRACT_ID: null,
  explorerUrl: jest.fn((hash) => `https://testnet.expert.stellar.org/tx/${hash}`),
  isValidStellarAddress: jest.fn((addr) => addr.startsWith("G") && addr.length === 56),
  isValidFederationAddress: jest.fn((addr) => addr.includes("*")),
  resolveFederationAddress: jest.fn(),
  submitTransaction: jest.fn(),
  fetchNetworkFeeStats: jest.fn(() =>
    Promise.resolve({ baseFeeXlm: 0.00001, feeLevel: "normal" })
  ),
  truncateMemoText: jest.fn((text: string) => text),
  STELLAR_BASE_FEE_XLM: 0.00001,
  STELLAR_MEMO_TEXT_MAX_BYTES: 28,
  STELLAR_MINIMUM_ACCOUNT_BALANCE_XLM: 1,
  server: {
    loadAccount: jest.fn(() => Promise.reject(new Error("Account not found"))),
    payments: jest.fn(),
    transactions: jest.fn(),
  },
}));

jest.mock("@/lib/wallet", () => ({
  signTransactionWithWallet: jest.fn(),
}));

jest.mock("@/utils/format", () => ({
  formatXLM: jest.fn((amount) => `${parseFloat(amount).toFixed(7)} XLM`),
  shortenAddress: jest.fn((addr, len) => addr?.slice(0, len) + "..."),
}));

jest.mock("@/components/PaymentStatusModal", () => ({
  __esModule: true,
  default: ({ isOpen, onClose }: any) => {
    if (!isOpen) return null;
    return (
      <div data-testid="payment-status-modal">
        <button onClick={onClose}>Close</button>
      </div>
    );
  },
}));

jest.mock("@/components/MultiSigFlow", () => ({
  MULTISIG_THRESHOLD_XLM: 1000,
}));

import SendPaymentForm from "../components/SendPaymentForm";

const VALID_ADDRESS = "GBRPYHIL2CI3WHZDTOOQFC6EB4RRJC3D5NZ2KMSUGSRNVO7ZFGIGSZ";

function defaultProps() {
  return {
    publicKey: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    xlmBalance: "100.0000000",
    usdcBalance: "50.0000000",
    onSuccess: jest.fn(),
  };
}

function getScannerButton() {
  return screen.getByRole("button", { name: /Scan QR code/i });
}

function captureScanCallback(): (result: { getText: () => string }, error: undefined, controls: { stop: () => void }) => void {
  return mockDecodeFromConstraints.mock.calls[0][2];
}

describe("QR Scanner in SendPaymentForm", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDecodeFromConstraints.mockResolvedValue(mockScannerControls);
    mockStop.mockClear();
    Object.defineProperty(navigator, "mediaDevices", {
      value: { getUserMedia: jest.fn().mockResolvedValue({}) },
      writable: true,
      configurable: true,
    });
  });

  it("shows scanner button on mobile viewports", () => {
    render(<SendPaymentForm {...defaultProps()} />);
    expect(getScannerButton()).toBeInTheDocument();
  });

  it("hides scanner button on desktop viewports (md:hidden class)", () => {
    Object.defineProperty(window, "innerWidth", { value: 1024, writable: true });
    render(<SendPaymentForm {...defaultProps()} />);
    expect(getScannerButton()).toHaveClass("md:hidden");
  });

  it("opens scanner modal when button clicked", async () => {
    render(<SendPaymentForm {...defaultProps()} />);
    const user = userEvent.setup();

    await user.click(getScannerButton());

    expect(screen.getByText("Scan QR Code")).toBeInTheDocument();
    expect(screen.getByText("Point your camera at a Stellar QR code")).toBeInTheDocument();
  });

  it("starts decoding from camera when modal opens", async () => {
    render(<SendPaymentForm {...defaultProps()} />);
    const user = userEvent.setup();

    await user.click(getScannerButton());

    await waitFor(() => {
      expect(mockDecodeFromConstraints).toHaveBeenCalledWith(
        { video: { facingMode: "environment" } },
        expect.anything(),
        expect.any(Function),
      );
    });
  });

  it("populates destination field from raw Stellar address scan", async () => {
    render(<SendPaymentForm {...defaultProps()} />);
    const user = userEvent.setup();

    await user.click(getScannerButton());

    await waitFor(() => {
      expect(mockDecodeFromConstraints).toHaveBeenCalled();
    });

    const callback = captureScanCallback();
    const mockResult = { getText: () => VALID_ADDRESS };

    act(() => {
      callback(mockResult, undefined, mockScannerControls);
    });

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/G\.\.\./)).toHaveValue(VALID_ADDRESS);
    });
  });

  it("populates destination, amount, and memo from SEP-0007 URI scan", async () => {
    render(<SendPaymentForm {...defaultProps()} />);
    const user = userEvent.setup();

    await user.click(getScannerButton());

    await waitFor(() => {
      expect(mockDecodeFromConstraints).toHaveBeenCalled();
    });

    const sepUri = `web+stellar:pay?destination=${VALID_ADDRESS}&amount=25.5&memo=Invoice%2042`;
    const callback = captureScanCallback();
    const mockResult = { getText: () => sepUri };

    act(() => {
      callback(mockResult, undefined, mockScannerControls);
    });

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/G\.\.\./)).toHaveValue(VALID_ADDRESS);
    });
    expect(screen.getByPlaceholderText("0.0000000")).toHaveValue("25.5");
    expect(screen.getByPlaceholderText("Payment note...")).toHaveValue("Invoice 42");
  });

  it("ignores scan results for invalid addresses and keeps scanner open", async () => {
    render(<SendPaymentForm {...defaultProps()} />);
    const user = userEvent.setup();

    await user.click(getScannerButton());

    await waitFor(() => {
      expect(mockDecodeFromConstraints).toHaveBeenCalled();
    });

    const callback = captureScanCallback();
    const mockResult = { getText: () => "not-a-stellar-address" };

    act(() => {
      callback(mockResult, undefined, mockScannerControls);
    });

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/G\.\.\./)).toHaveValue("");
    });
    expect(screen.getByText("Scan QR Code")).toBeInTheDocument();
  });

  it("closes scanner modal when close button clicked", async () => {
    render(<SendPaymentForm {...defaultProps()} />);
    const user = userEvent.setup();

    await user.click(getScannerButton());
    expect(screen.getByText("Scan QR Code")).toBeInTheDocument();

    const closeButton = screen.getByRole("button", { name: /Close scanner/i });
    await user.click(closeButton);

    await waitFor(() => {
      expect(screen.queryByText("Scan QR Code")).not.toBeInTheDocument();
    });
  });

  it("shows error when camera permission is denied", async () => {
    mockDecodeFromConstraints.mockRejectedValue(new Error("NotAllowedError"));
    render(<SendPaymentForm {...defaultProps()} />);
    const user = userEvent.setup();

    await user.click(getScannerButton());

    await waitFor(() => {
      expect(screen.getByText("Camera access denied or not available.")).toBeInTheDocument();
    });
    expect(screen.queryByText("Scan QR Code")).not.toBeInTheDocument();
  });
});

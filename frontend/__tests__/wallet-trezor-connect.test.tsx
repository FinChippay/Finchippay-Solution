/**
 * __tests__/wallet-trezor-connect.test.tsx
 * Component tests for the Trezor option in WalletConnect (issue #607).
 *
 * Verifies that the wallet selector offers Trezor alongside Freighter and
 * Ledger, and that the connect flow routes signing through Trezor.
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockUseWallet = {
  accounts: [],
  connectWallet: jest.fn(),
};

jest.mock("@/lib/useWallet", () => ({
  useWallet: () => mockUseWallet,
}));

// Trezor gateway
const getTrezorPublicKey = jest.fn();
const isTrezorSupported = jest.fn(() => true) as jest.Mock;
const setActiveWalletType = jest.fn();

// Freighter gateway
const isFreighterInstalled = jest.fn();
const connectWallet = jest.fn();

// Ledger gateway
const getLedgerPublicKey = jest.fn();
const isLedgerSupported = jest.fn(async () => true) as jest.Mock;

// SEP-0010 auth
const performSEP0010Auth = jest.fn();

jest.mock("@/lib/wallet", () => ({
  connectWallet: (...args: unknown[]) => connectWallet(...args),
  isFreighterInstalled: (...args: unknown[]) => isFreighterInstalled(...args),
  detectBrowser: () => "chrome",
  EXTENSION_URLS: { chrome: "https://chrome.google.com/webstore/detail/freighter" },
  performSEP0010Auth: (...args: unknown[]) => performSEP0010Auth(...args),
  getLedgerPublicKey: (...args: unknown[]) => getLedgerPublicKey(...args),
  isLedgerSupported: (...args: unknown[]) => isLedgerSupported(...args),
  getTrezorPublicKey: (...args: unknown[]) => getTrezorPublicKey(...args),
  isTrezorSupported: (...args: unknown[]) => isTrezorSupported(...args),
  setActiveWalletType: (...args: unknown[]) => setActiveWalletType(...args),
}));

jest.mock("@/components/ErrorBoundary", () => ({
  withErrorBoundary: (Component: React.ComponentType) => Component,
}));

jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import WalletConnect from "@/components/WalletConnect";

const KEY_TREZOR = "GCTREZOR" + "T".repeat(48);
const KEY_A = "GA" + "A".repeat(54);

describe("WalletConnect — Trezor option", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseWallet.accounts = [];
    getTrezorPublicKey.mockResolvedValue({ publicKey: KEY_TREZOR, error: null });
    performSEP0010Auth.mockResolvedValue({ error: null });
  });

  it("offers Freighter, Ledger and Trezor in the wallet selector", async () => {
    render(<WalletConnect />);

    await waitFor(() => {
      expect(screen.getByText("Connect Freighter Wallet")).toBeInTheDocument();
      expect(screen.getByText("Connect Ledger Hardware Wallet")).toBeInTheDocument();
      expect(screen.getByText("Connect Trezor Hardware Wallet")).toBeInTheDocument();
    });
  });

  it("connects via Trezor, routes signing through Trezor, and finalises the account", async () => {
    const user = userEvent.setup();
    render(<WalletConnect />);

    const trezorButton = await screen.findByText("Connect Trezor Hardware Wallet");
    await user.click(trezorButton);

    await waitFor(() => {
      expect(getTrezorPublicKey).toHaveBeenCalledTimes(1);
      expect(setActiveWalletType).toHaveBeenCalledWith("trezor");
      expect(performSEP0010Auth).toHaveBeenCalledWith(KEY_TREZOR);
      expect(mockUseWallet.connectWallet).toHaveBeenCalledWith(KEY_TREZOR);
    });
  });

  it("shows a clear error when Trezor connection fails (e.g. bridge not running)", async () => {
    getTrezorPublicKey.mockResolvedValue({
      publicKey: null,
      error: "Trezor bridge is not running. Please install/start Trezor Bridge and reconnect the device.",
    });

    const user = userEvent.setup();
    render(<WalletConnect />);

    const trezorButton = await screen.findByText("Connect Trezor Hardware Wallet");
    await user.click(trezorButton);

    await waitFor(() => {
      expect(
        screen.getByText(/Trezor bridge is not running/)
      ).toBeInTheDocument();
    });

    expect(performSEP0010Auth).not.toHaveBeenCalled();
    expect(mockUseWallet.connectWallet).not.toHaveBeenCalled();
  });

  it("keeps Freighter as the default when no Trezor error occurs", async () => {
    isFreighterInstalled.mockResolvedValue(true);
    connectWallet.mockResolvedValue({ publicKey: KEY_A, error: null });

    const user = userEvent.setup();
    render(<WalletConnect />);

    const freighterButton = await screen.findByText("Connect Freighter Wallet");
    await user.click(freighterButton);

    await waitFor(() => {
      expect(connectWallet).toHaveBeenCalled();
      expect(performSEP0010Auth).toHaveBeenCalled();
    });

    expect(setActiveWalletType).not.toHaveBeenCalled();
  });

  it("disables the Trezor button when Trezor is unsupported", async () => {
    isTrezorSupported.mockReturnValue(false);
    render(<WalletConnect />);

    const trezorButton = await screen.findByText("Connect Trezor Hardware Wallet");
    expect(trezorButton).toBeDisabled();
  });
});
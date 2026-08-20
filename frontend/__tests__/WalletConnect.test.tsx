/**
 * __tests__/WalletConnect.test.tsx
 * Tests for the unified Multi-Wallet provider picker component (#70).
 */

jest.mock("@sentry/nextjs", () => ({ captureException: jest.fn() }));

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import WalletConnect from "@/components/WalletConnect";
import { WalletProvider } from "@/lib/useWallet";

const mockPublicKey = "GBRPYHIL2CI3WHZDTOOQFC6EB4RRJC3D5NZ2KMSUGSRNVO7ZFGIGSZAA";

const connectWalletMock = jest.fn();
const performSEP0010AuthMock = jest.fn();
const isFreighterInstalledMock = jest.fn();
const getLedgerPublicKeyMock = jest.fn();
const isLedgerSupportedMock = jest.fn();

jest.mock("@/lib/wallet", () => {
  const original = jest.requireActual("@/lib/wallet");
  return {
    ...original,
    connectWallet: (...args: unknown[]) => connectWalletMock(...args),
    performSEP0010Auth: (...args: unknown[]) => performSEP0010AuthMock(...args),
    isFreighterInstalled: (...args: unknown[]) => isFreighterInstalledMock(...args),
    getLedgerPublicKey: (...args: unknown[]) => getLedgerPublicKeyMock(...args),
    isLedgerSupported: (...args: unknown[]) => isLedgerSupportedMock(...args),
    getConnectedPublicKey: jest.fn().mockResolvedValue(null),
    detectBrowser: jest.fn(() => "chrome"),
  };
});

jest.mock("next/router", () => ({
  useRouter: () => ({ push: jest.fn(), pathname: "/", query: {} }),
}));

function renderComponent(props = {}) {
  return render(
    <WalletProvider>
      <WalletConnect {...props} />
    </WalletProvider>,
  );
}

describe("WalletConnect Component (#70)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    isFreighterInstalledMock.mockResolvedValue(true);
    isLedgerSupportedMock.mockResolvedValue(true);
    connectWalletMock.mockResolvedValue({ publicKey: mockPublicKey, error: null });
    performSEP0010AuthMock.mockResolvedValue({ token: "jwt-test-token", error: null });
    getLedgerPublicKeyMock.mockResolvedValue({ publicKey: mockPublicKey, error: null });
  });

  it("renders all wallet providers in the picker", async () => {
    renderComponent();

    expect(await screen.findByText("Freighter")).toBeInTheDocument();
    expect(screen.getByText("Albedo")).toBeInTheDocument();
    expect(screen.getByText("xBull")).toBeInTheDocument();
    expect(screen.getByText("Lobstr")).toBeInTheDocument();
    expect(screen.getByText("WalletConnect")).toBeInTheDocument();
    expect(screen.getByText("Ledger Hardware")).toBeInTheDocument();
  });

  it("connects successfully with Freighter", async () => {
    const onConnectSuccess = jest.fn();
    renderComponent({ onConnectSuccess });

    const freighterBtn = await screen.findByText("Freighter");
    await userEvent.click(freighterBtn);

    await waitFor(() => {
      expect(connectWalletMock).toHaveBeenCalledWith("freighter");
      expect(performSEP0010AuthMock).toHaveBeenCalledWith(mockPublicKey, "freighter");
      expect(onConnectSuccess).toHaveBeenCalledWith(mockPublicKey);
    });
  });

  it("connects successfully with Albedo", async () => {
    const onConnectSuccess = jest.fn();
    renderComponent({ onConnectSuccess });

    const albedoBtn = await screen.findByText("Albedo");
    await userEvent.click(albedoBtn);

    await waitFor(() => {
      expect(connectWalletMock).toHaveBeenCalledWith("albedo");
      expect(performSEP0010AuthMock).toHaveBeenCalledWith(mockPublicKey, "albedo");
      expect(onConnectSuccess).toHaveBeenCalledWith(mockPublicKey);
    });
  });

  it("connects successfully with xBull", async () => {
    const onConnectSuccess = jest.fn();
    renderComponent({ onConnectSuccess });

    const xbullBtn = await screen.findByText("xBull");
    await userEvent.click(xbullBtn);

    await waitFor(() => {
      expect(connectWalletMock).toHaveBeenCalledWith("xbull");
      expect(performSEP0010AuthMock).toHaveBeenCalledWith(mockPublicKey, "xbull");
      expect(onConnectSuccess).toHaveBeenCalledWith(mockPublicKey);
    });
  });

  it("connects successfully with Lobstr", async () => {
    const onConnectSuccess = jest.fn();
    renderComponent({ onConnectSuccess });

    const lobstrBtn = await screen.findByText("Lobstr");
    await userEvent.click(lobstrBtn);

    await waitFor(() => {
      expect(connectWalletMock).toHaveBeenCalledWith("lobstr");
      expect(performSEP0010AuthMock).toHaveBeenCalledWith(mockPublicKey, "lobstr");
      expect(onConnectSuccess).toHaveBeenCalledWith(mockPublicKey);
    });
  });

  it("connects successfully with WalletConnect", async () => {
    const onConnectSuccess = jest.fn();
    renderComponent({ onConnectSuccess });

    const wcBtn = await screen.findByText("WalletConnect");
    await userEvent.click(wcBtn);

    await waitFor(() => {
      expect(connectWalletMock).toHaveBeenCalledWith("walletconnect");
      expect(performSEP0010AuthMock).toHaveBeenCalledWith(mockPublicKey, "walletconnect");
      expect(onConnectSuccess).toHaveBeenCalledWith(mockPublicKey);
    });
  });

  it("connects successfully with Ledger", async () => {
    const onConnectSuccess = jest.fn();
    renderComponent({ onConnectSuccess });

    const ledgerBtn = await screen.findByText("Ledger Hardware");
    await userEvent.click(ledgerBtn);

    await waitFor(() => {
      expect(getLedgerPublicKeyMock).toHaveBeenCalled();
      expect(performSEP0010AuthMock).toHaveBeenCalledWith(mockPublicKey);
      expect(onConnectSuccess).toHaveBeenCalledWith(mockPublicKey);
    });
  });

  it("shows install prompt when Freighter is not installed", async () => {
    isFreighterInstalledMock.mockResolvedValue(false);
    renderComponent();

    const freighterBtn = await screen.findByText("Freighter");
    await userEvent.click(freighterBtn);

    expect(await screen.findByText("Freighter not detected")).toBeInTheDocument();
    expect(screen.getByText("Get Freighter")).toBeInTheDocument();
  });

  it("displays error banner when connection fails", async () => {
    connectWalletMock.mockResolvedValue({
      publicKey: null,
      error: "User rejected connection in Albedo",
    });
    renderComponent();

    const albedoBtn = await screen.findByText("Albedo");
    await userEvent.click(albedoBtn);

    expect(await screen.findByText("User rejected connection in Albedo")).toBeInTheDocument();
  });
});

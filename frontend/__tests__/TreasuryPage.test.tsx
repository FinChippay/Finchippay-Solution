/**
 * __tests__/TreasuryPage.test.tsx
 * Unit tests for the /treasury page: loading, empty, error, and rendered states.
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import type { TreasuryOverview } from "@/lib/treasury";
import TreasuryPage from "../pages/treasury";

const mockFetchOverview = jest.fn();
const mockUseWallet = jest.fn(() => ({ publicKey: null }));
const mockLoggerError = jest.fn();

jest.mock("@/lib/treasury", () => ({
  fetchTreasuryOverview: (...args: unknown[]) => mockFetchOverview(...args),
  ADMIN_ACTION_LABELS: { pause: "Pause Contract" },
}));

jest.mock("@/lib/useWallet", () => ({
  useWallet: () => mockUseWallet(),
}));

jest.mock("@/lib/logger", () => ({
  logger: { error: (...args: unknown[]) => mockLoggerError(...args) },
}));

jest.mock("@/components/WalletConnect", () => ({
  __esModule: true,
  default: () => <div data-testid="wallet-connect">Wallet</div>,
}));

// sdk-instance.ts is a pre-existing broken file (PR#918); mock it so the page
// module graph (ProposalDetail → lib/wallet → lib/sdk-instance) compiles.
jest.mock("@/lib/sdk-instance", () => ({ sdk: null, initSdkAuth: jest.fn() }));

const overview: TreasuryOverview = {
  proposals: [
    {
      kind: "admin",
      id: 2,
      proposer: "GAA",
      actionType: "pause",
      actionData: [],
      approvals: ["GAA", "GBB"],
      signers: ["GAA", "GBB"],
      threshold: 2,
      status: "pending",
      rawStatus: "Pending",
      expirationLedger: 100,
      raw: {} as never,
    },
    {
      kind: "payment",
      id: 1,
      proposer: "GAA",
      actionType: "payment",
      actionData: [],
      approvals: ["GAA"],
      signers: ["GAA", "GBB"],
      threshold: 2,
      status: "pending",
      rawStatus: "Pending",
      expirationLedger: 0,
      raw: {} as never,
    },
  ],
  adminSigners: ["GAA", "GBB"],
  adminThreshold: 2,
};

describe("TreasuryPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders a loading skeleton while fetching", () => {
    mockFetchOverview.mockImplementation(() => new Promise(() => {}));
    render(<TreasuryPage />);
    expect(screen.getByRole("status", { name: /Loading treasury proposals/i })).toBeInTheDocument();
  });

  it("renders the proposal list when loaded", async () => {
    mockFetchOverview.mockResolvedValue(overview);
    render(<TreasuryPage />);
    expect(await screen.findByText("Treasury Governance")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText("Pause Contract").parentElement?.textContent).toContain("2 of 2 signed");
    });
    // Admin signer banner — the number spans split the text, so match textContent.
    await waitFor(() => {
      const banner = document.body.textContent ?? "";
      expect(banner).toMatch(/threshold\s+2\s+of\s+2/i);
    });
  });

  it("renders the empty state when no proposals exist", async () => {
    mockFetchOverview.mockResolvedValue({
      proposals: [],
      adminSigners: [],
      adminThreshold: 1,
    });
    render(<TreasuryPage />);
    expect(
      await screen.findByText(/No treasury proposals yet/i),
    ).toBeInTheDocument();
  });

  it("renders an error state when loading fails", async () => {
    mockFetchOverview.mockRejectedValue(new Error("RPC down"));
    render(<TreasuryPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("RPC down");
  });

  it("opens the detail view when a proposal card is clicked", async () => {
    const user = userEvent.setup();
    mockFetchOverview.mockResolvedValue(overview);
    render(<TreasuryPage />);

    const card = await screen.findByRole("button", { name: /Pause Contract proposal 2/i });
    await user.click(card);

    expect(await screen.findByText(/Governance proposal/i)).toBeInTheDocument();
    expect(screen.getAllByText("Pause Contract").length).toBeGreaterThanOrEqual(1);
  });
});
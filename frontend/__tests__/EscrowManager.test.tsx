import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

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

jest.mock("@/lib/escrowManager", () => ({
  getEscrows: jest.fn(),
  claimEscrow: jest.fn(),
  cancelEscrow: jest.fn(),
  getEscrowDetail: jest.fn(),
  categorizeEscrows: jest.fn(),
  sortEscrows: jest.fn(),
  filterEscrows: jest.fn(),
  clearEscrowCache: jest.fn(),
}));

jest.mock("@/lib/stellar", () => ({
  getCurrentLedger: jest.fn(),
  CONTRACT_ID: "CCONTRACT123456789",
}));

jest.mock("@/lib/useToast", () => ({
  useToast: jest.fn(),
}));

jest.mock("@/utils/format", () => ({
  copyToClipboard: jest.fn(),
}));

const mockGetEscrows = jest.requireMock("@/lib/escrowManager").getEscrows as jest.Mock;
const mockClaimEscrow = jest.requireMock("@/lib/escrowManager").claimEscrow as jest.Mock;
const mockCancelEscrow = jest.requireMock("@/lib/escrowManager").cancelEscrow as jest.Mock;
const mockCategorizeEscrows = jest.requireMock("@/lib/escrowManager").categorizeEscrows as jest.Mock;
const mockSortEscrows = jest.requireMock("@/lib/escrowManager").sortEscrows as jest.Mock;
const mockFilterEscrows = jest.requireMock("@/lib/escrowManager").filterEscrows as jest.Mock;
const mockUseWallet = jest.requireMock("@/lib/useWallet").useWallet as jest.Mock;
const mockGetCurrentLedger = jest.requireMock("@/lib/stellar").getCurrentLedger as jest.Mock;
const mockUseToast = jest.requireMock("@/lib/useToast").useToast as jest.Mock;
const mockCopyToClipboard = jest.requireMock("@/utils/format").copyToClipboard as jest.Mock;

import EscrowManage from "@/pages/escrow/manage";

const senderKey = "GBRPYHIL2CI3WHZDTOOQFC6EB4RRJC3D5NZ2KMSUGSRNVO7ZFGIGSZ";
const recipientKey = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

interface EscrowEntry {
  id: number;
  from: string;
  to: string;
  token: string;
  amount: string;
  releaseLedger: number;
  status: string;
  memo: string;
}

const sampleEscrows: EscrowEntry[] = [
  {
    id: 1,
    from: senderKey,
    to: recipientKey,
    token: "CDLZFC3SYJYDVR7P6JC4D723W55OHCH2EPCM4LD2V7NBCH7S2AFTIS2Z",
    amount: "100000000",
    releaseLedger: 1500,
    status: "Pending",
    memo: "",
  },
  {
    id: 2,
    from: recipientKey,
    to: senderKey,
    token: "CDLZFC3SYJYDVR7P6JC4D723W55OHCH2EPCM4LD2V7NBCH7S2AFTIS2Z",
    amount: "50000000",
    releaseLedger: 900,
    status: "Released",
    memo: "Payment",
  },
  {
    id: 3,
    from: senderKey,
    to: recipientKey,
    token: "CDLZFC3SYJYDVR7P6JC4D723W55OHCH2EPCM4LD2V7NBCH7S2AFTIS2Z",
    amount: "25000000",
    releaseLedger: 3000,
    status: "Cancelled",
    memo: "",
  },
];

describe("EscrowManage", () => {
  const mockShowToast = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockUseWallet.mockReturnValue({ publicKey: senderKey });
    mockGetCurrentLedger.mockResolvedValue(1000);
    mockGetEscrows.mockResolvedValue(sampleEscrows);
    mockCategorizeEscrows.mockImplementation((escrows: EscrowEntry[], pk: string) => ({
      active: escrows.filter((e: EscrowEntry) => e.status === "Pending" && (e.from === pk || e.to === pk)),
      completed: escrows.filter((e: EscrowEntry) => e.status === "Released" || e.status === "Cancelled"),
      incoming: escrows.filter((e: EscrowEntry) => e.status === "Pending" && e.to === pk),
    }));
    mockSortEscrows.mockImplementation((escrows) => escrows);
    mockFilterEscrows.mockImplementation((escrows, _q) => escrows);
    mockUseToast.mockReturnValue({ showToast: mockShowToast });
    mockClaimEscrow.mockResolvedValue("mock_tx_hash");
    mockCancelEscrow.mockResolvedValue("mock_tx_hash");
  });

  it("renders WalletConnect when no publicKey", () => {
    mockUseWallet.mockReturnValue({ publicKey: null });
    render(<EscrowManage />);
    expect(screen.getByTestId("wallet-connect")).toBeInTheDocument();
  });

  it("shows loading state then renders escrow cards", async () => {
    render(<EscrowManage />);

    expect(screen.getByText("Loading escrows...")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("#1")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Completed"));

    await waitFor(() => {
      expect(screen.getByText("#2")).toBeInTheDocument();
      expect(screen.getByText("#3")).toBeInTheDocument();
    });
  });

  it("shows empty state when no escrows in active tab", async () => {
    mockGetEscrows.mockResolvedValue([]);
    mockCategorizeEscrows.mockReturnValue({ active: [], completed: [], incoming: [] });

    render(<EscrowManage />);

    await waitFor(() => {
      expect(screen.getByText("No escrows found in this view.")).toBeInTheDocument();
    });
  });

  it("calls claimEscrow when claim button clicked", async () => {
    mockUseWallet.mockReturnValue({ publicKey: recipientKey });
    mockGetCurrentLedger.mockResolvedValue(2000);
    mockCategorizeEscrows.mockImplementation((escrows: EscrowEntry[], pk: string) => ({
      active: escrows.filter((e: EscrowEntry) => e.status === "Pending" && (e.from === pk || e.to === pk)),
      completed: escrows.filter((e: EscrowEntry) => e.status === "Released" || e.status === "Cancelled"),
      incoming: escrows.filter((e: EscrowEntry) => e.status === "Pending" && e.to === pk),
    }));

    render(<EscrowManage />);

    await waitFor(() => {
      expect(screen.getByText("#1")).toBeInTheDocument();
    });

    const claimBtns = screen.getAllByRole("button", { name: "Claim" });
    expect(claimBtns[0]).not.toBeDisabled();
    fireEvent.click(claimBtns[0]);

    await waitFor(() => {
      expect(mockClaimEscrow).toHaveBeenCalledWith(recipientKey, 1);
    });
  });

  it("shows cancel confirmation dialog then calls cancelEscrow", async () => {
    mockGetCurrentLedger.mockResolvedValue(500);
    render(<EscrowManage />);

    await waitFor(() => {
      expect(screen.getByText("#1")).toBeInTheDocument();
    });

    const cancelBtns = screen.getAllByRole("button", { name: "Cancel" });
    fireEvent.click(cancelBtns[0]);

    await waitFor(() => {
      expect(screen.getByText(/Are you sure/i)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /Confirm Cancel/i }));

    await waitFor(() => {
      expect(mockCancelEscrow).toHaveBeenCalledWith(senderKey, 1);
    });
  });

  it("closes cancel confirmation when Back clicked", async () => {
    mockGetCurrentLedger.mockResolvedValue(500);
    render(<EscrowManage />);

    await waitFor(() => {
      expect(screen.getByText("#1")).toBeInTheDocument();
    });

    const cancelBtns = screen.getAllByRole("button", { name: "Cancel" });
    fireEvent.click(cancelBtns[0]);

    await waitFor(() => {
      expect(screen.getByText(/Are you sure/i)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /Back/i }));

    await waitFor(() => {
      expect(screen.queryByText(/Are you sure/i)).not.toBeInTheDocument();
    });
  });

  it("switches between tabs", async () => {
    mockCategorizeEscrows.mockImplementation((escrows: EscrowEntry[], pk: string) => ({
      active: escrows.filter((e: EscrowEntry) => e.status === "Pending" && (e.from === pk || e.to === pk)),
      completed: escrows.filter((e: EscrowEntry) => e.status === "Released" || e.status === "Cancelled"),
      incoming: escrows.filter((e: EscrowEntry) => e.status === "Pending" && e.to === pk),
    }));

    render(<EscrowManage />);

    await waitFor(() => {
      expect(screen.getByText("#1")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Completed"));

    await waitFor(() => {
      expect(screen.getByText("#2")).toBeInTheDocument();
      expect(screen.getByText("#3")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Incoming"));

    await waitFor(() => {
      expect(screen.queryByText("#1")).not.toBeInTheDocument();
    });
  });

  it("shows current ledger number", async () => {
    render(<EscrowManage />);

    await waitFor(() => {
      expect(screen.getByText(/1,000/)).toBeInTheDocument();
    });
  });

  it("renders EscrowCountdown and MilestoneProgress components", async () => {
    render(<EscrowManage />);

    await waitFor(() => {
      expect(screen.getByText("#1")).toBeInTheDocument();
    });

    expect(screen.getByText("Progress")).toBeInTheDocument();
    expect(screen.getByText(/Deposited/)).toBeInTheDocument();
    expect(screen.getByText(/Approved/)).toBeInTheDocument();
  });
});

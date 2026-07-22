import React from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import StreamingPayments from "@/components/StreamingPayments";
import type { StreamRecord } from "@/lib/stellar";

const mockGetActiveStreamsForRecipient = jest.fn();
const mockGetCurrentLedger = jest.fn();
const mockBuildClaimStreamTransaction = jest.fn();
const mockSubmitTransaction = jest.fn();

jest.mock("@/lib/stellar", () => {
  const actual = jest.requireActual("@/lib/stellar");
  return {
    STELLAR_STROOPS_PER_XLM: actual.STELLAR_STROOPS_PER_XLM,
    computeStreamClaimable: actual.computeStreamClaimable,
    shortenAddress: actual.shortenAddress,
    getActiveStreamsForRecipient: (...args: unknown[]) =>
      mockGetActiveStreamsForRecipient(...args),
    getCurrentLedger: (...args: unknown[]) => mockGetCurrentLedger(...args),
    buildClaimStreamTransaction: (...args: unknown[]) =>
      mockBuildClaimStreamTransaction(...args),
    submitTransaction: (...args: unknown[]) => mockSubmitTransaction(...args),
  };
});

jest.mock("@/lib/wallet", () => ({
  signTransactionWithWallet: jest.fn().mockResolvedValue({ signedXDR: "SIGNED_XDR", error: null }),
}));

// Stub the animated counter so tests assert on the deterministic base
// claimable amount instead of racing requestAnimationFrame timing.
jest.mock("@/lib/useCountUp", () => ({
  useCountUp: () => ({ count: 0, elementRef: { current: null } }),
}));

const PUBLIC_KEY = "GRECIPIENT00000000000000000000000000000000000000000000";
const PAYER_KEY = "GPAYER000000000000000000000000000000000000000000000000";

function makeStream(overrides: Partial<StreamRecord> = {}): StreamRecord {
  return {
    id: 1,
    payer: PAYER_KEY,
    recipient: PUBLIC_KEY,
    token: "CTOKEN",
    ratePerLedger: "1000000", // 0.1 XLM per ledger
    deposited: "100000000", // 10 XLM
    claimed: "20000000", // 2 XLM
    startLedger: 100,
    closed: false,
    ...overrides,
  };
}

describe("StreamingPayments widget", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("shows an empty state when there are no active streams", async () => {
    mockGetActiveStreamsForRecipient.mockResolvedValue([]);
    mockGetCurrentLedger.mockResolvedValue(100);

    render(<StreamingPayments publicKey={PUBLIC_KEY} />);

    await waitFor(() => {
      expect(screen.getByTestId("streaming-payments-empty")).toBeInTheDocument();
    });
    expect(screen.getByText(/no active payment streams/i)).toBeInTheDocument();
  });

  it("renders claimed/deposited balances for active streams", async () => {
    // 50 ledgers elapsed since start_ledger (150 - 100) * rate 0.1 XLM = 5 XLM
    // streamed, minus 2 XLM already claimed = 3 XLM claimable.
    mockGetActiveStreamsForRecipient.mockResolvedValue([makeStream()]);
    mockGetCurrentLedger.mockResolvedValue(150);

    render(<StreamingPayments publicKey={PUBLIC_KEY} />);

    await waitFor(() => {
      expect(screen.getByTestId("stream-row-1")).toBeInTheDocument();
    });

    expect(screen.getByText(/from gpayer/i)).toBeInTheDocument();
    expect(screen.getByText(/2\.0000 \/ 10\.0000 XLM claimed/i)).toBeInTheDocument();
    expect(screen.getByText(/3\.0000/)).toBeInTheDocument();
  });

  it("renders multiple active streams and skips closed ones", async () => {
    mockGetActiveStreamsForRecipient.mockResolvedValue([
      makeStream({ id: 1 }),
      makeStream({ id: 2, deposited: "50000000", claimed: "0" }),
    ]);
    mockGetCurrentLedger.mockResolvedValue(150);

    render(<StreamingPayments publicKey={PUBLIC_KEY} />);

    await waitFor(() => {
      expect(screen.getByTestId("stream-row-1")).toBeInTheDocument();
      expect(screen.getByTestId("stream-row-2")).toBeInTheDocument();
    });
  });

  it("submits a claim_stream invocation when Claim is clicked", async () => {
    mockGetActiveStreamsForRecipient.mockResolvedValue([makeStream()]);
    mockGetCurrentLedger.mockResolvedValue(150);
    mockBuildClaimStreamTransaction.mockResolvedValue({ toXDR: () => "UNSIGNED_XDR" });
    mockSubmitTransaction.mockResolvedValue({ hash: "abc123" });

    render(<StreamingPayments publicKey={PUBLIC_KEY} />);

    await waitFor(() => {
      expect(screen.getByTestId("stream-row-1")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /claim/i }));

    await waitFor(() => {
      expect(mockBuildClaimStreamTransaction).toHaveBeenCalledWith(PUBLIC_KEY, 1);
      expect(mockSubmitTransaction).toHaveBeenCalledWith("SIGNED_XDR");
    });
  });

  it("disables the claim button when nothing is claimable yet", async () => {
    mockGetActiveStreamsForRecipient.mockResolvedValue([
      makeStream({ startLedger: 150, claimed: "0" }),
    ]);
    mockGetCurrentLedger.mockResolvedValue(150);

    render(<StreamingPayments publicKey={PUBLIC_KEY} />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /claim/i })).toBeDisabled();
    });
  });
});

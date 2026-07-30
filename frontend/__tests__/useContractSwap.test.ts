/**
 * __tests__/useContractSwap.test.ts
 *
 * Tests for the on-chain contract-swap hook (Issue #9 / #479).
 */

import { renderHook, act } from "@testing-library/react";

// ─── Mocks (declared before importing the hook) ────────────────────────────

const mockSwapExactTokensForTokens = jest.fn();
const mockGetSwapFee = jest.fn();

jest.mock("@/lib/contract-bindings", () => ({
  FinchippayContractClient: jest.fn().mockImplementation(() => ({
    swapExactTokensForTokens: mockSwapExactTokensForTokens,
    getSwapFee: mockGetSwapFee,
  })),
}));

jest.mock("@/lib/stellar", () => ({
  CONTRACT_ID: "CCONTRACTIDEXAMPLE",
  NETWORK_PASSPHRASE: "Test SDF Network ; October 2015",
  STELLAR_STROOPS_PER_XLM: 10_000_000,
  USDC: {
    contractId: () => "CUSDCCONTRACTEXAMPLE",
  },
  submitTransaction: jest.fn(),
}));

jest.mock("@stellar/stellar-sdk", () => ({
  Asset: {
    native: () => ({
      contractId: () => "CXLMCONTRACTEXAMPLE",
    }),
  },
}));

jest.mock("@stellar/freighter-api", () => ({
  signTransaction: jest.fn(),
}));

import { useContractSwap } from "../hooks/useContractSwap";
import * as stellarModule from "@/lib/stellar";
import * as freighterModule from "@stellar/freighter-api";

const mockSubmitTransaction = stellarModule.submitTransaction as jest.Mock;
const mockSignTransaction = freighterModule.signTransaction as jest.Mock;

const PUBLIC_KEY = "GBRPYHIL2CI3WHZDTOOQFC6EB4RRJC3D5NZ2KMSUGSRNVO7ZFGIGSZ";

beforeEach(() => {
  jest.clearAllMocks();
  mockSwapExactTokensForTokens.mockResolvedValue({ toXDR: () => "mock-tx-xdr" });
  mockGetSwapFee.mockResolvedValue(30);
  mockSignTransaction.mockResolvedValue({ signedTxXdr: "mock-signed-xdr" });
  mockSubmitTransaction.mockResolvedValue({ hash: "tx-hash-abc" });
});

describe("useContractSwap", () => {
  it("starts idle with no error", () => {
    const { result } = renderHook(() => useContractSwap());
    expect(result.current.isSwapping).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("fetches the current swap fee in basis points", async () => {
    const { result } = renderHook(() => useContractSwap());
    let fee = 0;
    await act(async () => {
      fee = await result.current.fetchSwapFeeBps();
    });
    expect(fee).toBe(30);
    expect(mockGetSwapFee).toHaveBeenCalled();
  });

  it("builds, signs, and submits a swap_exact_tokens_for_tokens transaction", async () => {
    const { result } = renderHook(() => useContractSwap());

    let swapResult;
    await act(async () => {
      swapResult = await result.current.swap({
        publicKey: PUBLIC_KEY,
        payToken: "XLM",
        receiveToken: "USDC",
        payAmount: "100",
        minReceiveAmount: "99.7",
      });
    });

    expect(mockSwapExactTokensForTokens).toHaveBeenCalledWith(
      PUBLIC_KEY,
      PUBLIC_KEY,
      "CXLMCONTRACTEXAMPLE",
      "CUSDCCONTRACTEXAMPLE",
      1_000_000_000n,
      997_000_000n,
      ["CXLMCONTRACTEXAMPLE", "CUSDCCONTRACTEXAMPLE"]
    );
    expect(mockSignTransaction).toHaveBeenCalledWith(
      "mock-tx-xdr",
      expect.objectContaining({ networkPassphrase: expect.any(String) })
    );
    expect(mockSubmitTransaction).toHaveBeenCalledWith("mock-signed-xdr");
    expect(swapResult).toEqual({
      hash: "tx-hash-abc",
      minAmountOut: "99.7",
    });
  });

  it("rejects when pay and receive tokens are the same", async () => {
    const { result } = renderHook(() => useContractSwap());

    await expect(
      result.current.swap({
        publicKey: PUBLIC_KEY,
        payToken: "XLM",
        receiveToken: "XLM",
        payAmount: "10",
        minReceiveAmount: "9.9",
      })
    ).rejects.toThrow(/must differ/i);
  });

  it("rejects a non-positive pay amount", async () => {
    const { result } = renderHook(() => useContractSwap());

    await expect(
      result.current.swap({
        publicKey: PUBLIC_KEY,
        payToken: "XLM",
        receiveToken: "USDC",
        payAmount: "0",
        minReceiveAmount: "0",
      })
    ).rejects.toThrow(/must be positive/i);
  });

  it("sets error state and re-throws when signing fails", async () => {
    mockSignTransaction.mockResolvedValueOnce({
      error: { message: "User rejected" },
    });
    const { result } = renderHook(() => useContractSwap());

    await act(async () => {
      await expect(
        result.current.swap({
          publicKey: PUBLIC_KEY,
          payToken: "XLM",
          receiveToken: "USDC",
          payAmount: "100",
          minReceiveAmount: "99.7",
        })
      ).rejects.toThrow(/User rejected/);
    });

    expect(result.current.error).toBe("User rejected");
    expect(result.current.isSwapping).toBe(false);
  });

  it("sets error state when submission fails", async () => {
    mockSubmitTransaction.mockRejectedValueOnce(new Error("Horizon 400"));
    const { result } = renderHook(() => useContractSwap());

    await act(async () => {
      await expect(
        result.current.swap({
          publicKey: PUBLIC_KEY,
          payToken: "XLM",
          receiveToken: "USDC",
          payAmount: "100",
          minReceiveAmount: "99.7",
        })
      ).rejects.toThrow("Horizon 400");
    });

    expect(result.current.error).toBe("Horizon 400");
  });
});

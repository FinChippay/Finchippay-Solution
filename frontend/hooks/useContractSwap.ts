/**
 * hooks/useContractSwap.ts
 *
 * On-chain swap execution via FinchippayContract's `swap_exact_tokens_for_tokens`
 * (Issue #9 / #479), offered in TradeForm as an alternative to the Horizon
 * path-payment flow in `lib/pathFinder.ts`.
 *
 * Unlike the Horizon flow, this settles against the contract directly: a
 * protocol fee (default 0.3%, admin-configurable) is deducted and sent to the
 * fee collector, and the remainder is swapped for `token_out`. See the
 * pricing-model note on `swap_exact_tokens_for_tokens` in
 * `contracts/finchippay-contract/src/lib.rs` — this contract does not yet
 * source live AMM/DEX prices, so the swap settles 1:1 against the contract's
 * own token reserves.
 */

import { Asset } from "@stellar/stellar-sdk";
import { useCallback, useState } from "react";
import { FinchippayContractClient } from "@/lib/contract-bindings";
import {
  CONTRACT_ID,
  NETWORK_PASSPHRASE,
  STELLAR_STROOPS_PER_XLM,
  USDC,
  submitTransaction,
} from "@/lib/stellar";

// ─── Types ──────────────────────────────────────────────────────────────────

/** Token codes supported by the contract swap path (mirrors TradeForm). */
export type ContractSwapToken = "XLM" | "USDC";

export interface ContractSwapParams {
  publicKey: string;
  payToken: ContractSwapToken;
  receiveToken: ContractSwapToken;
  /** "You Pay" amount, as a decimal string (e.g. "100.5"). */
  payAmount: string;
  /** Minimum acceptable "You Receive" amount after slippage, decimal string. */
  minReceiveAmount: string;
}

export interface ContractSwapResult {
  /** Submitted transaction hash. */
  hash: string;
  /** Amount actually requested as the floor for slippage protection. */
  minAmountOut: string;
}

export interface UseContractSwapReturn {
  isSwapping: boolean;
  error: string | null;
  /** Execute an exact-input swap through the contract. */
  swap: (params: ContractSwapParams) => Promise<ContractSwapResult>;
  /** Current protocol swap fee, in basis points (30 = 0.3%). */
  fetchSwapFeeBps: () => Promise<number>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Resolve a token code to its Soroban SAC contract address. */
function tokenContractId(code: ContractSwapToken): string {
  const asset = code === "XLM" ? Asset.native() : USDC;
  return asset.contractId(NETWORK_PASSPHRASE);
}

/** Convert a decimal amount string to contract base units (7 decimals). */
function toContractUnits(amount: string): bigint {
  const parsed = parseFloat(amount);
  if (!parsed || parsed <= 0) return BigInt(0);
  return BigInt(Math.round(parsed * STELLAR_STROOPS_PER_XLM));
}

// ─── Hook ───────────────────────────────────────────────────────────────────

/**
 * Drives on-chain swaps through FinchippayContract as an alternative to the
 * Horizon path-payment flow used elsewhere in TradeForm.
 */
export function useContractSwap(): UseContractSwapReturn {
  const [isSwapping, setIsSwapping] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSwapFeeBps = useCallback(async (): Promise<number> => {
    if (!CONTRACT_ID) return 0;
    const client = new FinchippayContractClient(CONTRACT_ID);
    return client.getSwapFee();
  }, []);

  const swap = useCallback(
    async ({
      publicKey,
      payToken,
      receiveToken,
      payAmount,
      minReceiveAmount,
    }: ContractSwapParams): Promise<ContractSwapResult> => {
      if (!CONTRACT_ID) {
        throw new Error("Contract ID is not configured.");
      }
      if (payToken === receiveToken) {
        throw new Error("Pay and receive tokens must differ.");
      }

      const amountIn = toContractUnits(payAmount);
      const minAmountOut = toContractUnits(minReceiveAmount);
      if (amountIn <= BigInt(0)) {
        throw new Error("Amount must be positive.");
      }

      setIsSwapping(true);
      setError(null);

      try {
        const tokenIn = tokenContractId(payToken);
        const tokenOut = tokenContractId(receiveToken);

        const client = new FinchippayContractClient(CONTRACT_ID);
        const tx = await client.swapExactTokensForTokens(
          publicKey,
          publicKey,
          tokenIn,
          tokenOut,
          amountIn,
          minAmountOut,
          [tokenIn, tokenOut]
        );

        const { signTransaction } = await import("@stellar/freighter-api");
        const signed = await signTransaction(tx.toXDR(), {
          networkPassphrase: NETWORK_PASSPHRASE,
        });
        if (signed.error) {
          throw new Error(signed.error.message || "Transaction signing failed");
        }

        const result = await submitTransaction(signed.signedTxXdr);
        const hash = (result as { hash?: string })?.hash ?? "";

        return {
          hash,
          minAmountOut: minReceiveAmount,
        };
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Contract swap failed";
        setError(message);
        throw err instanceof Error ? err : new Error(message);
      } finally {
        setIsSwapping(false);
      }
    },
    []
  );

  return { isSwapping, error, swap, fetchSwapFeeBps };
}

export default useContractSwap;

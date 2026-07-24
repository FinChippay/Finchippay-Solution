/**
 * hooks/useSimulatedTransactionFlow.ts
 *
 * A convenience hook that wraps the common pattern:
 * 1. Build a transaction (from a builder function)
 * 2. Simulate it (show preview)
 * 3. Sign it (with Freighter)
 * 4. Submit it (to Horizon)
 *
 * This reduces boilerplate in escrow, streaming, and multi-sig flows.
 *
 * Usage:
 *   const flow = useSimulatedTransactionFlow({ publicKey });
 *   // In your handler:
 *   await flow.execute({
 *     builder: () => buildSomeTransaction(args),
 *     onSuccess: (hash) => { ... },
 *     onError: (err) => { ... },
 *   });
 *   // The preview modal shows automatically before signing.
 *
 *   // Render the preview modal:
 *   <TransactionSimulationPreview
 *     isOpen={flow.showPreview}
 *     onClose={() => flow.setShowPreview(false)}
 *     onProceed={flow.handleProceedToSign}
 *     simulation={flow.simulationResult}
 *     loading={flow.simLoading}
 *     error={flow.simError}
 *     warning={flow.simWarning}
 *   />
 */

import { useState, useCallback } from "react";
import { Transaction } from "@stellar/stellar-sdk";
import {
  submitTransaction,
  NETWORK_PASSPHRASE,
} from "@/lib/stellar";
import { signTransactionWithWallet } from "@/lib/wallet";
import {
  useTransactionSimulation,
  type SimulationResult,
} from "@/hooks/useTransactionSimulation";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ExecuteFlowOptions {
  /** A function that builds an unsigned transaction */
  builder: () => Promise<Transaction> | Transaction;
  /** Called on successful submission with the transaction hash */
  onSuccess?: (hash: string) => void;
  /** Called if any step fails */
  onError?: (error: string) => void;
  /** If true, skip the simulation preview and go straight to signing */
  skipSimulation?: boolean;
}

export interface UseSimulatedTransactionFlowOptions {
  /** The connected wallet's public key */
  publicKey: string | null;
}

export function useSimulatedTransactionFlow(
  options: UseSimulatedTransactionFlowOptions
) {
  const { publicKey } = options;
  const simulation = useTransactionSimulation({ publicKey });

  const [showPreview, setShowPreview] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [flowError, setFlowError] = useState<string | null>(null);

  // Store the pending builder + callbacks for when the user approves
  const [pendingFlow, setPendingFlow] = useState<{
    builder: () => Promise<Transaction> | Transaction;
    onSuccess?: (hash: string) => void;
    onError?: (error: string) => void;
  } | null>(null);

  /**
   * Execute a transaction flow:
   * 1. Build transaction
   * 2. Simulate it (shows preview modal)
   * 3. Wait for user approval
   * 4. Sign with Freighter
   * 5. Submit to Horizon
   */
  const execute = useCallback(
    async (opts: ExecuteFlowOptions) => {
      if (!publicKey) {
        opts.onError?.("Wallet not connected");
        return;
      }

      setExecuting(true);
      setFlowError(null);

      try {
        // Step 1: Build the transaction
        const tx = await opts.builder();

        if (opts.skipSimulation) {
          // Skip simulation — go straight to signing
          const { signedXDR, error: signError } = await signTransactionWithWallet(tx.toXDR());
          if (signError || !signedXDR) {
            throw new Error(signError || "Signing was rejected.");
          }
          const result = await submitTransaction(signedXDR);
          opts.onSuccess?.(result.hash);
          return;
        }

        // Step 2: Run simulation
        const xdr = tx.toXDR();
        const simResult = await simulation.simulate(xdr);
        setPendingFlow({
          builder: opts.builder,
          onSuccess: opts.onSuccess,
          onError: opts.onError,
        });
        setShowPreview(true);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Transaction failed";
        setFlowError(message);
        opts.onError?.(message);
      } finally {
        setExecuting(false);
      }
    },
    [publicKey, simulation]
  );

  /**
   * Called when the user clicks "Proceed to Sign" in the preview modal.
   * This signs the already-simulated transaction and submits it.
   */
  const handleProceedToSign = useCallback(async () => {
    if (!pendingFlow) return;
    if (!publicKey) {
      pendingFlow.onError?.("Wallet not connected");
      return;
    }

    setShowPreview(false);
    setExecuting(true);
    setFlowError(null);

    try {
      // Re-build the transaction to get a fresh copy
      const tx = await pendingFlow.builder();
      const xdr = tx.toXDR();

      // Use the prepared transaction XDR from simulation if available
      const txToSign =
        simulation.result?.preparedTransactionXdr ?? xdr;

      // Step 3: Sign with Freighter
      const { signedXDR, error: signError } = await signTransactionWithWallet(txToSign);
      if (signError || !signedXDR) {
        throw new Error(signError || "Signing was rejected.");
      }

      // Step 4: Submit to Horizon
      const result = await submitTransaction(signedXDR);
      pendingFlow.onSuccess?.(result.hash);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Transaction failed";
      setFlowError(message);
      pendingFlow.onError?.(message);
    } finally {
      setExecuting(false);
      setPendingFlow(null);
    }
  }, [pendingFlow, publicKey, simulation.result]);

  const reset = useCallback(() => {
    setShowPreview(false);
    setExecuting(false);
    setFlowError(null);
    setPendingFlow(null);
    simulation.reset();
  }, [simulation]);

  return {
    // From the simulation hook
    simulationResult: simulation.result,
    simLoading: simulation.loading,
    simError: simulation.error,
    simWarning: simulation.warning,

    // Flow state
    showPreview,
    executing,
    flowError,

    // Actions
    execute,
    handleProceedToSign,
    setShowPreview,
    reset,
  };
}

export default useSimulatedTransactionFlow;
/**
 * hooks/useTransactionSimulation.ts
 *
 * React hook for simulating Soroban contract transactions before signing.
 * Returns the simulation result (balance changes, fees, errors) and
 * handles the full simulation lifecycle.
 *
 * Usage:
 *   const sim = useTransactionSimulation();
 *   await sim.simulate(unsignedTxXdr);
 *   // sim.result contains balance changes, fees, etc.
 *   // sim.error contains simulation error (if any)
 *   // sim.loading is true during simulation
 */

import { Transaction, rpc, scValToNative, xdr } from "@stellar/stellar-sdk";
import { useState, useCallback } from "react";
import {
  getSorobanServer,
  getBalances,
  NETWORK_PASSPHRASE,
  STELLAR_STROOPS_PER_XLM,
  type WalletBalance,
} from "@/lib/stellar";

/** Maximum amount shown in a simulation preview, expressed in asset units. */
export const MAX_DISPLAY_AMOUNT = 1_000_000_000;

// ─── Types ──────────────────────────────────────────────────────────────────

export interface BalanceChange {
  /** Asset identifier (e.g. "native" or "USDC:GA5...") */
  asset: string;
  /** Short asset code (e.g. "XLM" or "USDC") */
  assetCode: string;
  /** Balance before the transaction */
  before: string;
  /** Balance after the transaction */
  after: string;
  /** The difference (after - before) */
  difference: string;
}

export interface ResourceFee {
  /** The minimum resource fee in stroops as reported by the simulation */
  stroops: bigint;
  /** The minimum resource fee converted to XLM */
  xlm: number;
  cpuInstructions?: number;
  readBytes?: number;
  writeBytes?: number;
}

export interface ContractError {
  /** Error message from the contract simulation */
  message: string;
  /** Optional error code */
  code?: string;
}

export interface SimulationResult {
  /** Whether the simulation was successful */
  success: boolean;
  /** Balance changes detected (before vs after) */
  balanceChanges: BalanceChange[];
  /** Resource fees from the simulation (Soroban) */
  resourceFee: ResourceFee | null;
  /** Contract error if simulation failed */
  contractError: ContractError | null;
  /** Raw simulation response for advanced inspection */
  rawSimulation: rpc.Api.SimulateTransactionResponse | null;
  /** The original transaction XDR that was simulated */
  transactionXdr: string;
  /** The prepared (assembled) transaction XDR after simulation */
  preparedTransactionXdr: string | null;
}

export interface SimulationState {
  /** Whether a simulation is in progress */
  loading: boolean;
  /** The simulation result (null if not yet simulated) */
  result: SimulationResult | null;
  /** A network-level error (e.g. Soroban RPC unreachable) */
  error: string | null;
  /** A warning if simulation failed but user can still proceed */
  warning: string | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Fetch current balances for a public key and format them into a map
 * keyed by asset identifier for quick lookup.
 */
async function fetchBalanceMap(publicKey: string): Promise<Map<string, WalletBalance>> {
  const balances = await getBalances(publicKey);
  const map = new Map<string, WalletBalance>();
  for (const b of balances) {
    map.set(b.asset, b);
  }
  return map;
}

/**
 * Estimate the base fee in XLM from the transaction's fee field.
 * The fee field is the *base fee* in stroops. The actual max fee
 * is baseFee * numOperations. We display the base fee in XLM.
 */
function estimateBaseFeeXlm(tx: Transaction): number {
  const feeStroops = parseInt(tx.fee, 10);
  if (!Number.isFinite(feeStroops) || feeStroops <= 0) return 0;
  return feeStroops / STELLAR_STROOPS_PER_XLM;
}

interface SanitizedBalanceChanges {
  changes: BalanceChange[];
  issue: string | null;
}

function sanitizeBalanceChanges(balanceChanges: BalanceChange[]): SanitizedBalanceChanges {
  let issue: string | null = null;
  const changes = balanceChanges.map((change) => {
    const numbers = [change.before, change.after, change.difference].map(Number);
    const hasInvalidValue = numbers.some(
      (value, index) =>
        !Number.isFinite(value) ||
        Math.abs(value) > MAX_DISPLAY_AMOUNT ||
        (index < 2 && value < 0),
    );

    if (hasInvalidValue) {
      issue = "Simulation returned an unsafe balance amount. Review the transaction before signing.";
    }

    const clamp = (value: number) =>
      Math.max(-MAX_DISPLAY_AMOUNT, Math.min(MAX_DISPLAY_AMOUNT, value));
    return {
      ...change,
      before: Number.isFinite(numbers[0]) ? String(clamp(numbers[0])) : "0",
      after: Number.isFinite(numbers[1]) ? String(clamp(numbers[1])) : "0",
      difference: Number.isFinite(numbers[2]) ? String(clamp(numbers[2])) : "0",
    };
  });

  return { changes, issue };
}

function sanitizeResourceFee(resourceFee: ResourceFee | null): {
  fee: ResourceFee | null;
  issue: string | null;
} {
  if (!resourceFee) return { fee: null, issue: null };

  const maxStroops = BigInt(MAX_DISPLAY_AMOUNT) * BigInt(STELLAR_STROOPS_PER_XLM);
  const hasInvalidValue =
    resourceFee.stroops < 0 ||
    resourceFee.stroops > maxStroops ||
    !Number.isFinite(resourceFee.xlm) ||
    resourceFee.xlm < 0 ||
    resourceFee.xlm > MAX_DISPLAY_AMOUNT;
  const stroops = resourceFee.stroops < 0
    ? 0n
    : resourceFee.stroops > maxStroops
      ? maxStroops
      : resourceFee.stroops;

  return {
    fee: {
      ...resourceFee,
      stroops,
      xlm: Number(stroops) / STELLAR_STROOPS_PER_XLM,
    },
    issue: hasInvalidValue
      ? "Simulation returned an unsafe fee estimate. Review the transaction before signing."
      : null,
  };
}

/**
 * Check if simulation returned a contract-level error (e.g. "release_ledger not reached").
 */
function extractContractError(
  sim: rpc.Api.SimulateTransactionResponse | null,
): ContractError | null {
  if (!sim) return null;

  // Check for simulation error
  if (rpc.Api.isSimulationError(sim)) {
    // The error field often contains the contract's panic message
    const msg = sim.error || "Unknown contract error";
    return { message: msg };
  }

  // Check result for any error codes embedded in the return value
  if (rpc.Api.isSimulationSuccess(sim) && sim.result) {
    // Some contracts encode errors in the result value
    const retval = sim.result.retval;
    if (retval) {
      try {
        const decoded = scValToNative(retval);
        // If the return value is an error variant, surface it
        if (decoded && typeof decoded === "object" && "error" in decoded) {
          return { message: String((decoded as Record<string, unknown>).error) };
        }
      } catch {
        // Ignore decode failures on the return value
      }
    }
  }

  return null;
}

/**
 * Extract the minimum resource fee from a successful Soroban simulation.
 */
function extractResourceFee(sim: rpc.Api.SimulateTransactionResponse | null): ResourceFee | null {
  if (!sim || rpc.Api.isSimulationError(sim)) return null;

  const response = sim as unknown as Record<string, unknown>;
  const minResourceFee = response.minResourceFee ?? null;

  if (minResourceFee == null) return null;

  const stroops = BigInt(minResourceFee);
  const xlm = Number(stroops) / STELLAR_STROOPS_PER_XLM;
  const cost = (response.cost ?? {}) as Record<string, unknown>;
  let cpuInstructions = Number(cost.cpuInsns ?? cost.cpuInstructions ?? 0);
  let readBytes = Number(cost.readBytes ?? 0);
  let writeBytes = Number(cost.writeBytes ?? 0);
  if (typeof response.transactionData === "string") {
    try {
      const resources = xdr.SorobanTransactionData.fromXDR(
        response.transactionData,
        "base64",
      ).resources();
      cpuInstructions ||= Number(resources.instructions().toString());
      readBytes ||= Number(resources.diskReadBytes());
      writeBytes ||= Number(resources.writeBytes());
    } catch {
      // Keep any metrics supplied directly by the RPC.
    }
  }
  return { stroops, xlm, cpuInstructions, readBytes, writeBytes };
}

/**
 * Compute balance changes by comparing before/after balances.
 * This is best-effort — we compare the current on-chain balance
 * with an estimate of what it would be after the transaction.
 *
 * For Soroban contracts, we look at the stateChanges in the
 * simulation response to determine which accounts/balances
 * are affected.
 */
async function computeBalanceChanges(
  publicKey: string,
  sim: rpc.Api.SimulateTransactionResponse | null,
  tx: Transaction,
): Promise<BalanceChange[]> {
  if (!sim || rpc.Api.isSimulationError(sim)) return [];

  const changes: BalanceChange[] = [];
  const beforeBalances = await fetchBalanceMap(publicKey);

  // Try to extract balance changes from stateChanges in the simulation
  const response = sim as unknown as Record<string, unknown>;
  const stateChanges = response.stateChanges ?? null;

  if (stateChanges && Array.isArray(stateChanges)) {
    // Process stateChanges to detect XLM balance changes
    for (const rawChange of stateChanges) {
      try {
        if (!rawChange || typeof rawChange !== "object") continue;
        const change = rawChange as Record<string, unknown>;
        const key = change.key;
        const before = change.before;
        const after = change.after;

        // If this looks like a balance entry for our user, compute the diff
        if (key && before !== undefined && after !== undefined) {
          const beforeNative = scValToNative(before);
          const afterNative = scValToNative(after);

          if (typeof beforeNative === "bigint" || typeof beforeNative === "number") {
            const beforeNum = Number(beforeNative);
            const afterNum = Number(afterNative);
            const diff = afterNum - beforeNum;

            // Only include meaningful changes (avoid noise from dust)
            if (Math.abs(diff) > 0) {
              changes.push({
                asset: "native",
                assetCode: "XLM",
                before: (beforeNum / STELLAR_STROOPS_PER_XLM).toFixed(7),
                after: (afterNum / STELLAR_STROOPS_PER_XLM).toFixed(7),
                difference: (diff / STELLAR_STROOPS_PER_XLM).toFixed(7),
              });
            }
          }
        }
      } catch {
        // Skip state changes we can't parse
      }
    }
  }

  // If we couldn't extract from stateChanges, use the current balances
  // and estimate based on the transaction operations
  if (changes.length === 0) {
    const currentXlm = beforeBalances.get("native");
    if (currentXlm) {
      const currentBalance = parseFloat(currentXlm.balance);

      // Estimate: subtract the amount being sent + fees
      let estimatedChange = 0;
      for (const op of tx.operations) {
        if (op.type === "payment" || op.type === "createAccount") {
          const operation = op as unknown as Record<string, unknown>;
          const opBody =
            operation.body && typeof operation.body === "object"
              ? (operation.body as Record<string, unknown>)
              : operation;
          const amount =
            "amount" in opBody && typeof opBody.amount === "string" ? parseFloat(opBody.amount) : 0;
          estimatedChange -= amount;
        }
      }

      const feeXlm = estimateBaseFeeXlm(tx);

      changes.push({
        asset: "native",
        assetCode: "XLM",
        before: currentBalance.toFixed(7),
        after: Math.max(0, currentBalance + estimatedChange - feeXlm).toFixed(7),
        difference: (estimatedChange - feeXlm).toFixed(7),
      });
    }
  }

  return changes;
}

// ─── Hook ───────────────────────────────────────────────────────────────────

interface UseTransactionSimulationOptions {
  /** Public key of the connected wallet */
  publicKey: string | null;
}

export function useTransactionSimulation(options: UseTransactionSimulationOptions) {
  const { publicKey } = options;
  const [state, setState] = useState<SimulationState>({
    loading: false,
    result: null,
    error: null,
    warning: null,
  });

  /**
   * Simulate a transaction by XDR string.
   *
   * @param transactionXdr - The unsigned transaction XDR to simulate.
   * @returns The simulation result, or null if simulation failed entirely.
   */
  const simulate = useCallback(
    async (transactionXdr: string): Promise<SimulationResult | null> => {
      if (!publicKey) {
        setState((prev: SimulationState) => ({
          ...prev,
          error: "Wallet not connected",
          loading: false,
        }));
        return null;
      }

      setState((prev: SimulationState) => ({
        ...prev,
        loading: true,
        error: null,
        warning: null,
        result: null,
      }));

      try {
        // Parse the transaction
        let tx: Transaction;
        try {
          tx = new Transaction(transactionXdr, NETWORK_PASSPHRASE);
        } catch {
          setState((prev: SimulationState) => ({
            ...prev,
            loading: false,
            error: "Invalid transaction XDR",
          }));
          return null;
        }

        const sorobanServer = getSorobanServer();

        // Perform the simulation
        const sim = await sorobanServer.simulateTransaction(tx);

        // Check for simulation error (contract-level errors)
        const contractError = extractContractError(sim);
        const resourceFee = extractResourceFee(sim);
        const { changes: balanceChanges, issue: balanceIssue } = sanitizeBalanceChanges(
          await computeBalanceChanges(publicKey, sim, tx),
        );
        const { fee: sanitizedResourceFee, issue: feeIssue } = sanitizeResourceFee(resourceFee);
        const simulationIssue = balanceIssue || feeIssue
          ? { message: balanceIssue || feeIssue }
          : contractError;

        // The prepared transaction (with resource fees filled in)
        let preparedTransactionXdr: string | null = null;
        if (sim && !rpc.Api.isSimulationError(sim)) {
          try {
            const prepared = await sorobanServer.prepareTransaction(tx);
            preparedTransactionXdr = prepared.toXDR();
          } catch {
            // Preparation may fail for some edge cases, but that's okay
          }
        }

        const success = !simulationIssue && sim !== null;

        const result: SimulationResult = {
          success,
          balanceChanges,
          resourceFee: sanitizedResourceFee,
          contractError: simulationIssue,
          rawSimulation: sim,
          transactionXdr: transactionXdr,
          preparedTransactionXdr,
        };

        // If there's a contract error, set a warning (not error) so the
        // user can still choose to proceed
        if (simulationIssue) {
          setState((prev: SimulationState) => ({
            ...prev,
            loading: false,
            result,
            warning: `Simulation warning: ${simulationIssue.message}`,
          }));
        } else {
          setState((prev: SimulationState) => ({
            ...prev,
            loading: false,
            result,
          }));
        }

        return result;
      } catch (err: unknown) {
        // Network-level failure (e.g. RPC unreachable)
        const message = err instanceof Error ? err.message : "Simulation failed unexpectedly";
        setState((prev: SimulationState) => ({
          ...prev,
          loading: false,
          error: message,
          warning: "Could not simulate. You can still proceed, but the transaction may fail.",
        }));
        return null;
      }
    },
    [publicKey],
  );

  /**
   * Reset the simulation state.
   */
  const reset = useCallback(() => {
    setState({
      loading: false,
      result: null,
      error: null,
      warning: null,
    });
  }, []);

  return {
    ...state,
    simulate,
    reset,
  };
}

export default useTransactionSimulation;

/**
 * @file lib/soroban.ts
 * @description Unified Soroban RPC client layer that abstracts all contract interactions.
 *
 * Provides a typed FinchippayClient class with consistent error handling, retry logic,
 * and contract method mapping. Replaces ad-hoc Soroban calls scattered across components.
 *
 * @see {@link https://soroban.stellar.org | Soroban RPC Docs}
 */

import {
  Transaction,
  Account,
  Contract,
  Asset,
  TransactionBuilder,
  nativeToScVal,
  scValToNative,
  rpc,
  xdr,
} from "@stellar/stellar-sdk";
import {
  CONTRACT_ID,
  NETWORK_PASSPHRASE,
  getSorobanServer,
  STELLAR_STROOPS_PER_XLM,
  STELLAR_BASE_FEE_STROOPS,
} from "./stellar";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface EscrowRecord {
  id: number;
  from: string;
  to: string;
  token: string;
  amount: string;
  releaseLedger: number;
  status: "Pending" | "Released" | "Cancelled";
}

export interface StreamRecord {
  id: number;
  payer: string;
  recipient: string;
  token: string;
  deposited: string;
  claimed: string;
  ratePerLedger: string;
  startLedger: number;
  lastClaimLedger: number;
  status: "Active" | "Ended" | "Cancelled";
}

/** Contract `MultiSigProposal` (contracts/finchippay-contract/src/types.rs). */
export interface MultiSigProposal {
  id: number;
  proposer: string;
  recipient: string;
  token: string;
  amount: string;
  threshold: number;
  signers: string[];
  approvals: string[];
  status: "Pending" | "Executed" | "Cancelled";
  expirationLedger: number;
  /** Back-compat alias for legacy consumers reading `.from`. */
  from: string;
  /** Back-compat alias for legacy consumers reading `.to`. */
  to: string;
  /** Back-compat aliases for legacy consumers reading `.executed/.cancelled`. */
  executed: boolean;
  cancelled: boolean;
}

/** A single-admin-governance action proposed for approval by the admin signer set. */
export interface AdminActionProposal {
  id: number;
  /** e.g. "pause", "unpause", "set_admin_signers", "set_pauser", "upgrade", "reconcile_balance". */
  actionType: string;
  /** Function-specific payload produced by `propose_admin_action`. */
  actionData: unknown[];
  /** Admin signers that have approved so far. */
  approvals: string[];
  /** Number of unique admin approvals required to execute. */
  threshold: number;
  /** Whether this proposal has been executed. */
  executed: boolean;
  /** Ledger after which the proposal expires and can no longer be approved. */
  expirationLedger: number;
}

export interface ContractStats {
  escrows: number;
  streams: number;
  multisigs: number;
}

export interface SendTipResult {
  transactionHash: string;
}

export interface SorobanResourceEstimate {
  cpuInstructions: number;
  readBytes: number;
  writeBytes: number;
  resourceFeeStroops: number;
}

/** Simulate an already-built Soroban transaction using the shared RPC client. */
export async function simulateTransactionResources(
  transaction: Transaction,
): Promise<SorobanResourceEstimate> {
  const simulation = await getSorobanServer().simulateTransaction(transaction);
  if (rpc.Api.isSimulationError(simulation)) {
    throw new Error(`Simulation failed: ${simulation.error}`);
  }

  const response = simulation as unknown as Record<string, unknown>;
  const cost = (response.cost ?? {}) as Record<string, unknown>;
  let cpuInstructions = Number(cost.cpuInsns ?? cost.cpuInstructions ?? 0);
  let readBytes = Number(cost.readBytes ?? 0);
  let writeBytes = Number(cost.writeBytes ?? 0);

  // read/write limits live in transactionData in current RPC responses. Decode
  // the XDR so this also works with SDK versions that do not expose them on cost.
  const transactionData = response.transactionData;
  if (typeof transactionData === "string") {
    try {
      const resources = xdr.SorobanTransactionData.fromXDR(transactionData, "base64").resources();
      cpuInstructions ||= Number(resources.instructions().toString());
      readBytes ||= Number(resources.diskReadBytes());
      writeBytes ||= Number(resources.writeBytes());
    } catch {
      // Older/custom RPCs may return a non-XDR transactionData shape.
    }
  }

  return {
    cpuInstructions,
    readBytes,
    writeBytes,
    resourceFeeStroops: Number(response.minResourceFee ?? 0),
  };
}

// ─── Contract Error Codes ─────────────────────────────────────────────────

/** Maps `ContractError` discriminant values from the Soroban contract catalogue. */
const ERROR_MESSAGES: Record<number, string> = {
  1: "Contract already initialized",
  2: "Unauthorized — you don't have permission for this action",
  3: "Amount must be positive",
  4: "Release ledger must be in the future",
  5: "Not found — the referenced escrow, stream, or proposal does not exist",
  6: "Invalid state — this operation is not allowed in the current state",
  7: "Arithmetic overflow detected",
  8: "Invalid threshold — signer list length does not match the required threshold",
  9: "Length mismatch — recipient or signer arrays have mismatched lengths",
  10: "Already signed — you have already approved this proposal",
  11: "Insufficient funds — the stream has insufficient deposited funds",
  12: "Contract paused — value-transferring operations are temporarily blocked",
  13: "Self-transfer is not allowed",
  14: "Batch too large — the number of recipients exceeds the maximum allowed",
  15: "Duplicate signer detected in the signers list",
  16: "Proposal expired — this proposal can no longer be approved",
  17: "Transfer failed — token balance did not increase by the expected amount",
  18: "Index full — the recipient already has the maximum number of escrows",
  19: "Emergency withdrawal is not ready yet",
  20: "Not an authorized admin signer for this withdrawal",
  21: "Invalid swap path — path is malformed or does not match the tokens",
  22: "Slippage exceeded — the swap would return less than the minimum amount out",
  23: "Excessive amount in — input required exceeds the maximum amount in",
  24: "Invalid fee — new fee exceeds the maximum allowed swap fee",
  25: "Admin action proposal not found",
  26: "Admin action proposal has already been executed",
  27: "Release ledger not reached — the yield escrow is not yet releasable",
  28: "Reentrant call blocked — a mutating operation was re-entered mid-flight",
  29: "Stale swap path — path references empty reserves or a repeated token",
};

function getErrorMessage(code: number): string {
  return ERROR_MESSAGES[code] || `Unknown contract error (code: ${code})`;
}

function parseContractError(error: unknown): string {
  if (error instanceof Error) {
    const msg = error.message;

    // Try to extract contract error code from simulation/transaction errors
    const codeMatch = msg.match(/ContractError\((\d+)\)/);
    if (codeMatch) {
      return getErrorMessage(parseInt(codeMatch[1], 10));
    }

    // Try to extract from result_codes
    const resultCodesMatch = msg.match(/"op_no_source_account"|"op_underfunded"|"op_low_reserve"/);
    if (resultCodesMatch) {
      return `Transaction rejected by the network: ${resultCodesMatch[0]}`;
    }

    return msg;
  }
  return "An unknown error occurred while interacting with the contract.";
}

// ─── Retry Logic ──────────────────────────────────────────────────────────

interface RetryOptions {
  maxRetries?: number;
  baseDelay?: number;
  maxDelay?: number;
}

const DEFAULT_RETRY: RetryOptions = {
  maxRetries: 3,
  baseDelay: 1000,
  maxDelay: 25000,
};

async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = DEFAULT_RETRY,
): Promise<T> {
  const { maxRetries = 3, baseDelay = 1000, maxDelay = 25000 } = options;
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      lastError = err;

      // Don't retry contract panics / business logic errors — only network/timeout
      if (err instanceof Error) {
        const msg = err.message;
        if (msg.includes("ContractError") || msg.includes("Contract") || msg.includes("Error(")) {
          throw new Error(parseContractError(err));
        }
      }

      if (attempt < maxRetries) {
        const delay = Math.min(baseDelay * Math.pow(5, attempt), maxDelay);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError instanceof Error
    ? new Error(`RPC request failed after ${maxRetries + 1} attempts: ${lastError.message}`)
    : new Error(`RPC request failed after ${maxRetries + 1} attempts.`);
}

// ─── FinchippayClient ─────────────────────────────────────────────────────

export class FinchippayClient {
  private rpcUrl: string;
  private contractId: string;
  private networkPassphrase: string;

  constructor(rpcUrl: string, contractId: string, networkPassphrase: string) {
    this.rpcUrl = rpcUrl;
    this.contractId = contractId;
    this.networkPassphrase = networkPassphrase;
  }

  private getServer(): rpc.Server {
    return new rpc.Server(this.rpcUrl);
  }

  private getContract(): Contract {
    return new Contract(this.contractId);
  }

  private getXlmContractId(): string {
    return Asset.native().contractId(this.networkPassphrase);
  }

  private get stroopsPerXlm(): number {
    return STELLAR_STROOPS_PER_XLM;
  }

  private get baseFee(): string {
    return String(STELLAR_BASE_FEE_STROOPS);
  }

  /**
   * Simulate a contract invocation and return the result.
   * Internal helper used by all query methods.
   */
  private async simulateCall(method: string, args: unknown[], source?: string): Promise<unknown> {
    return withRetry(async () => {
      const server = this.getServer();
      const contract = this.getContract();
      const account = new Account(
        source || "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        "0",
      );

      const tx = new TransactionBuilder(account, {
        fee: this.baseFee,
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(contract.call(method, ...args.map((a) => this.toScVal(a))))
        .setTimeout(30)
        .build();

      const sim = await server.simulateTransaction(tx);

      if (rpc.Api.isSimulationError(sim)) {
        throw new Error(`Simulation failed: ${sim.error}`);
      }

      if (rpc.Api.isSimulationSuccess(sim) && sim.result) {
        return scValToNative(sim.result.retval);
      }

      return null;
    });
  }

  /**
   * Build and preflight a contract invocation transaction.
   * Internal helper used by all mutation methods.
   */
  private async buildTransaction(
    method: string,
    args: unknown[],
    sourcePublicKey: string,
  ): Promise<Transaction> {
    return withRetry(async () => {
      const server = this.getServer();
      const contract = this.getContract();
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { getNetworkConfig } = require("./stellar") as typeof import("./stellar");
      const config = getNetworkConfig();
      // Load source account from Horizon for sequence number
      const response = await fetch(`${config.horizonUrl}/accounts/${sourcePublicKey}`);
      if (!response.ok) {
        throw new Error(`Failed to load account ${sourcePublicKey}`);
      }
      const accountData = await response.json();
      const sourceAccount = new Account(sourcePublicKey, accountData.sequence);

      const tx = new TransactionBuilder(sourceAccount, {
        fee: this.baseFee,
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(contract.call(method, ...args.map((a) => this.toScVal(a))))
        .setTimeout(60)
        .build();

      // We use the Soroban RPC server for simulation/preflight
      const simulated = await server.simulateTransaction(tx);
      if (rpc.Api.isSimulationError(simulated)) {
        throw new Error(`Simulation failed: ${simulated.error}`);
      }

      return server.prepareTransaction(tx);
    });
  }

  /**
   * Convert a JS value to a ScVal for contract invocation.
   */
  private toScVal(value: unknown): import("@stellar/stellar-sdk").xdr.ScVal {
    if (typeof value === "number") {
      if (Number.isInteger(value)) {
        // u64 ancestors are used for multisig/admin proposal ids; fall back to
        // u64 for any integer beyond the u32 range.
        return value >= 0 && value <= 0xffffffff
          ? nativeToScVal(value, { type: "u32" })
          : nativeToScVal(BigInt(value), { type: "u64" });
      }
      return nativeToScVal(value, { type: "i128" });
    }
    if (typeof value === "bigint") {
      return nativeToScVal(value, { type: "i128" });
    }
    if (typeof value === "string") {
      // Check if it looks like a Stellar address
      if (/^G[A-Z0-9]{55}$/.test(value)) {
        return nativeToScVal(value, { type: "address" });
      }
      // Check if it looks like a contract hash
      if (/^C[A-Z0-9]{55}$/.test(value)) {
        return nativeToScVal(value, { type: "address" });
      }
      // Otherwise treat as symbol/string
      return nativeToScVal(value, { type: "symbol" });
    }
    if (Array.isArray(value)) {
      return nativeToScVal(value, { type: "vec" });
    }
    // Fall back to native conversion
    return nativeToScVal(value);
  }

  // ── Build transaction methods (return Transaction for wallet signing) ──

  /**
   * Build a send_tip transaction, ready for wallet signing.
   */
  async buildSendTipTx(
    token: string,
    from: string,
    to: string,
    amount: string,
  ): Promise<Transaction> {
    const stroops = BigInt(Math.round(parseFloat(amount) * this.stroopsPerXlm));
    return this.buildTransaction("send_tip", [token, from, to, stroops], from);
  }

  /**
   * Build a create_escrow transaction, ready for wallet signing.
   */
  async buildCreateEscrowTx(
    token: string,
    from: string,
    to: string,
    amount: string,
    releaseLedger: number,
  ): Promise<{ tx: Transaction; escrowId?: number }> {
    const stroops = BigInt(Math.round(parseFloat(amount) * this.stroopsPerXlm));
    const tx = await this.buildTransaction(
      "create_escrow",
      [token, from, to, stroops, releaseLedger],
      from,
    );
    return { tx };
  }

  /**
   * Build a claim_escrow transaction, ready for wallet signing.
   */
  async buildClaimEscrowTx(escrowId: number, caller: string): Promise<Transaction> {
    return this.buildTransaction("claim_escrow", [escrowId], caller);
  }

  /**
   * Build a cancel_escrow transaction, ready for wallet signing.
   */
  async buildCancelEscrowTx(escrowId: number, caller: string): Promise<Transaction> {
    return this.buildTransaction("cancel_escrow", [escrowId], caller);
  }

  /**
   * Build a claim_stream transaction, ready for wallet signing.
   */
  async buildClaimStreamTx(streamId: number, caller: string): Promise<Transaction> {
    return this.buildTransaction("claim_stream", [streamId], caller);
  }

  // ── Query methods (read-only contract calls) ────────────────────────────

  async sendTip(token: string, from: string, to: string, amount: string): Promise<SendTipResult> {
    const tx = await this.buildSendTipTx(token, from, to, amount);
    return { transactionHash: tx.hash().toString("hex") };
  }

  async getTipTotal(recipient: string): Promise<string> {
    const result = await this.simulateCall("get_tip_total", [recipient], recipient);
    return result?.toString() ?? "0";
  }

  async getEscrow(escrowId: number, caller?: string): Promise<EscrowRecord | null> {
    const result = await this.simulateCall("get_escrow", [escrowId], caller);
    if (!result) return null;
    const decoded = result as Record<string, unknown>;
    return {
      id: Number(escrowId),
      from: String(decoded.from ?? ""),
      to: String(decoded.to ?? ""),
      token: String(decoded.token ?? ""),
      amount: String(decoded.amount ?? "0"),
      releaseLedger: Number(decoded.releaseLedger ?? 0),
      status: String(decoded.status ?? "Pending") as EscrowRecord["status"],
    };
  }

  async getStream(streamId: number, caller?: string): Promise<StreamRecord | null> {
    const result = await this.simulateCall("get_stream", [streamId], caller);
    if (!result) return null;
    const decoded = result as Record<string, unknown>;
    return {
      id: Number(streamId),
      payer: String(decoded.payer ?? ""),
      recipient: String(decoded.recipient ?? ""),
      token: String(decoded.token ?? ""),
      deposited: String(decoded.deposited ?? "0"),
      claimed: String(decoded.claimed ?? "0"),
      ratePerLedger: String(decoded.ratePerLedger ?? "0"),
      startLedger: Number(decoded.startLedger ?? 0),
      lastClaimLedger: Number(decoded.lastClaimLedger ?? 0),
      status: String(decoded.status ?? "Active") as StreamRecord["status"],
    };
  }

  async getClaimable(streamId: number, caller?: string): Promise<string> {
    const result = await this.simulateCall("get_claimable", [streamId], caller);
    return result?.toString() ?? "0";
  }

  async getContractVersion(): Promise<number> {
    const result = await this.simulateCall("version", []);
    return Number(result ?? 0);
  }

  async getContractStats(caller?: string): Promise<ContractStats> {
    const result = await this.simulateCall("get_stats", [], caller);
    if (!result) return { escrows: 0, streams: 0, multisigs: 0 };
    const decoded = result as Record<string, unknown>;
    return {
      escrows: Number(decoded.escrows ?? 0),
      streams: Number(decoded.streams ?? 0),
      multisigs: Number(decoded.multisigs ?? 0),
    };
  }

  async isPaused(caller?: string): Promise<boolean> {
    const result = await this.simulateCall("is_paused", [], caller);
    return Boolean(result);
  }

  async getMultisig(proposalId: number, caller?: string): Promise<MultiSigProposal | null> {
    const result = await this.simulateCall("get_multisig", [proposalId], caller);
    if (!result) return null;
    const decoded = result as Record<string, unknown>;
    const signersRaw = decoded.signers;
    const approvalsRaw = decoded.approvals;
    const proposer = String(decoded.proposer ?? "");
    const recipient = String(decoded.recipient ?? "");
    const status = String(decoded.status ?? "Pending") as MultiSigProposal["status"];
    const executed = status === "Executed" || Boolean(decoded.executed ?? false);
    const cancelled = status === "Cancelled" || Boolean(decoded.cancelled ?? false);
    return {
      id: Number(proposalId),
      proposer,
      recipient,
      token: String(decoded.token ?? ""),
      amount: String(decoded.amount ?? "0"),
      threshold: Number(decoded.threshold ?? 0),
      signers: Array.isArray(signersRaw) ? signersRaw.map(String) : [],
      approvals: Array.isArray(approvalsRaw) ? approvalsRaw.map(String) : [],
      status,
      expirationLedger: Number(decoded.expiration_ledger ?? decoded.expirationLedger ?? 0),
      from: proposer,
      to: recipient,
      executed,
      cancelled,
    };
  }

  /**
   * Return the number of payment multi-sig proposals created so far
   * (mirrors `get_multisig_count` on the contract).
   */
  async getMultisigCount(caller?: string): Promise<number> {
    const result = await this.simulateCall("get_multisig_count", [], caller);
    return Number(result ?? 0);
  }

  // ── Treasury / admin-governance query methods ─────────────────────────

  /** Return the current admin signer set (G... addresses). */
  async getAdminSigners(caller?: string): Promise<string[]> {
    const result = await this.simulateCall("get_admin_signers", [], caller);
    if (!Array.isArray(result)) return [];
    return result.map(String);
  }

  /** Return the number of approvals required for admin actions to execute. */
  async getAdminSignersThreshold(caller?: string): Promise<number> {
    const result = await this.simulateCall("get_admin_signers_threshold", [], caller);
    return Number(result ?? 1);
  }

  /**
   * Fetch a single admin-governance proposal from the contract.
   *
   * The contract stores admin-action proposals as `AdminActionProposal`
   * (id, action_type, action_data, approvals, threshold, executed,
   * expiration_ledger). `action_data` is a `Vec<Val>` of crypto primitives
   * (addresses / u32 / symbols / bytes); `scValToNative` yields them as JS
   * values so we keep the raw array for display.
   */
  async getAdminActionProposal(
    proposalId: number,
    caller?: string,
  ): Promise<AdminActionProposal | null> {
    const result = await this.simulateCall("get_admin_action_proposal", [proposalId], caller);
    if (!result) return null;
    const decoded = result as Record<string, unknown>;
    const approvalsRaw = decoded.approvals;
    return {
      id: Number(proposalId),
      actionType: String(decoded.action_type ?? decoded.actionType ?? "unknown"),
      actionData: Array.isArray(decoded.action_data ?? decoded.actionData)
        ? (decoded.action_data ?? decoded.actionData)
        : [],
      approvals: Array.isArray(approvalsRaw) ? approvalsRaw.map(String) : [],
      threshold: Number(decoded.threshold ?? 1),
      executed: Boolean(decoded.executed ?? false),
      expirationLedger: Number(decoded.expiration_ledger ?? decoded.expirationLedger ?? 0),
    };
  }

  /**
   * Build an approve_admin_action transaction, ready for wallet signing.
   *
   * When the approval count reaches the configured admin threshold the
   * contract auto-executes the action.
   */
  async buildApproveAdminActionTx(
    proposalId: number,
    approver: string,
  ): Promise<Transaction> {
    return this.buildTransaction("approve_admin_action", [proposalId, approver], approver);
  }

  /**
   * Build an approve_multisig transaction for a payment multi-sig proposal,
   * ready for wallet signing.
   */
  async buildApprovePaymentMultisigTx(
    proposalId: number,
    signer: string,
  ): Promise<Transaction> {
    return this.buildTransaction("approve_multisig", [proposalId, signer], signer);
  }
}

// ─── Lazy Singleton ─────────────────────────────────────────────────────────

let _client: FinchippayClient | null = null;

/**
 * Registry of reset callbacks for all contract clients that need to be
 * invalidated when the network changes. Other modules can register their
 * own reset functions here so that resetClient() invalidates every cached
 * contract client, not just the one in this file.
 */
type ResetCallback = () => void;
const _resetRegistry: ResetCallback[] = [];

/**
 * Register a reset callback that will be invoked when resetClient() is called.
 * Use this to invalidate module-level client singletons elsewhere so a network
 * switch clears every cached contract client in one call.
 * @param callback A function that resets the calling module's cached client.
 */
export function registerClientReset(callback: ResetCallback): void {
  _resetRegistry.push(callback);
}

/**
 * Get or create the default FinchippayClient singleton.
 *
 * Reads NEXT_PUBLIC_CONTRACT_ID and constructs the RPC URL from the
 * current network configuration.
 */
export function getClient(): FinchippayClient {
  if (!_client) {
    const rpcUrl = process.env.NEXT_PUBLIC_SOROBAN_RPC_URL || "https://soroban-testnet.stellar.org";
    const contractId = CONTRACT_ID;
    const passphrase = NETWORK_PASSPHRASE;

    if (!contractId) {
      throw new Error(
        "NEXT_PUBLIC_CONTRACT_ID is not configured. Set it in your environment variables.",
      );
    }

    _client = new FinchippayClient(rpcUrl, contractId, passphrase);
  }
  return _client;
}

/**
 * Reset the singleton and every registered client singleton (useful for testing
 * or network changes). After calling this, the next call to getClient() or any
 * registered client factory will build a fresh instance targeting the current
 * network configuration.
 */
export function resetClient(): void {
  _client = null;
  for (const callback of _resetRegistry) {
    callback();
  }
}

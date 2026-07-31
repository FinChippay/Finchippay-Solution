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

export interface MultiSigProposal {
  id: number;
  token: string;
  from: string;
  to: string;
  amount: string;
  approvals: number;
  threshold: number;
  executed: boolean;
  cancelled: boolean;
}

export interface ContractStats {
  escrows: number;
  streams: number;
  multisigs: number;
}

export interface SendTipResult {
  transactionHash: string;
}

// ─── Contract Error Codes ─────────────────────────────────────────────────

const ERROR_MESSAGES: Record<number, string> = {
  1: "Contract already initialized",
  2: "Unauthorized — you don't have permission for this action",
  3: "Amount must be positive",
  4: "Insufficient balance — the sender account does not have enough funds",
  5: "Escrow not found — no escrow exists with that ID",
  6: "Escrow already released — funds have already been claimed",
  7: "Escrow already cancelled — the escrow was previously cancelled",
  8: "Not escrow recipient — only the designated recipient can claim this escrow",
  9: "Not escrow sender — only the sender can cancel this escrow",
  10: "Release ledger not reached — the release ledger has not been reached yet",
  11: "Stream not found — no payment stream exists with that ID",
  12: "Stream already ended — the stream has already been closed",
  13: "Stream already cancelled — the stream was previously cancelled",
  14: "Not stream participant — you are not a participant in this stream",
  15: "Multi-sig proposal not found — no proposal exists with that ID",
  16: "Already approved — you have already approved this proposal",
  17: "Threshold already met — the signature threshold has already been reached",
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
        if (
          msg.includes("ContractError") ||
          msg.includes("Contract") ||
          msg.includes("Error(")
        ) {
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
  private async simulateCall(
    method: string,
    args: unknown[],
    source?: string,
  ): Promise<unknown> {
    return withRetry(async () => {
      const server = this.getServer();
      const contract = this.getContract();
      const account = new Account(source || "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", "0");

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
      const { getNetworkConfig } = require("./stellar") as typeof import("./stellar");
      const config = getNetworkConfig();
      // Load source account from Horizon for sequence number
      const response = await fetch(
        `${config.horizonUrl}/accounts/${sourcePublicKey}`,
      );
      if (!response.ok) {
        throw new Error(`Failed to load account ${sourcePublicKey}`);
      }
      const accountData = await response.json();
      const sourceAccount = new Account(sourcePublicKey, accountData.sequence);

      const tx = new TransactionBuilder(sourceAccount, {
        fee: this.baseFee,
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(
          contract.call(method, ...args.map((a) => this.toScVal(a))),
        )
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
      return nativeToScVal(value, { type: Number.isInteger(value) ? "u32" : "i128" });
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

  async sendTip(
    token: string,
    from: string,
    to: string,
    amount: string,
  ): Promise<SendTipResult> {
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
      status: (String(decoded.status ?? "Pending")) as EscrowRecord["status"],
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
      status: (String(decoded.status ?? "Active")) as StreamRecord["status"],
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

  async getMultisig(
    proposalId: number,
    caller?: string,
  ): Promise<MultiSigProposal | null> {
    const result = await this.simulateCall("get_multisig", [proposalId], caller);
    if (!result) return null;
    const decoded = result as Record<string, unknown>;
    return {
      id: Number(proposalId),
      token: String(decoded.token ?? ""),
      from: String(decoded.from ?? ""),
      to: String(decoded.to ?? ""),
      amount: String(decoded.amount ?? "0"),
      approvals: Number(decoded.approvals ?? 0),
      threshold: Number(decoded.threshold ?? 0),
      executed: Boolean(decoded.executed ?? false),
      cancelled: Boolean(decoded.cancelled ?? false),
    };
  }
}

// ─── Lazy Singleton ─────────────────────────────────────────────────────────

let _client: FinchippayClient | null = null;

/**
 * Get or create the default FinchippayClient singleton.
 *
 * Reads NEXT_PUBLIC_CONTRACT_ID and constructs the RPC URL from the
 * current network configuration.
 */
export function getClient(): FinchippayClient {
  if (!_client) {
    const rpcUrl =
      process.env.NEXT_PUBLIC_SOROBAN_RPC_URL || "https://soroban-testnet.stellar.org";
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
 * Reset the singleton (useful for testing or network changes).
 */
export function resetClient(): void {
  _client = null;
}

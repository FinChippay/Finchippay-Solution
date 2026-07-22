/**
 * @finchippay/sdk — Typed API client for the Finchippay Solution backend.
 *
 * Provides a fetch-based client that automatically handles:
 *  - SEP-0010 challenge/response authentication (JWT storage)
 *  - Base URL configuration
 *  - Typed request/response methods for every API endpoint
 */

import type {
  /* Account */
  AccountInfo,
  BalanceResponse,
  ResolveUsernameResponse,
  RegisterUsernameRequest,
  /* Analytics */
  AnalyticsSummary,
  TopRecipient,
  ActivityDay,
  /* Payments */
  PaymentRecord,
  PaymentStats,
  PaymentHistoryParams,
  /* Tips */
  Tip,
  TipStats,
  CreateTipRequest,
  /* Turrets (txFunctions) */
  TxFunctionChallengeRequest,
  TxFunctionChallengeResponse,
  TxFunctionDeployRequest,
  TxFunctionDeployment,
  ExecutionLogEntry,
  TurretListParams,
  /* Scheduled Transactions */
  ScheduledTransaction,
  ScheduleTransactionRequest,
  /* SEP-0024 */
  Sep24InitiateRequest,
  Sep24InteractiveResponse,
  Sep24Transaction,
  /* AI Parsing */
  ParsePaymentRequest,
  ParsePaymentResponse,
  /* Auth */
  ChallengeResponse,
  TokenResponse,
  AuthRequest,
  /* Health */
  HealthStatus,
  /* Federation */
  FederationRecord,
  /* Generic */
  SuccessResponse,
} from "./types";

/* ─── Internal helpers ─── */

/** Default base URL for the Finchippay API. */
const DEFAULT_BASE_URL = "http://localhost:4000";

/** Storage key for the cached JWT token. */
const TOKEN_KEY = "finchippay_sdk_token";

/* ─── Client options ─── */

export interface FinchippayClientOptions {
  /** Base URL of the Finchippay API server. Defaults to http://localhost:4000. */
  baseUrl?: string;
  /** Optional pre-existing JWT token. If not provided, the client will look for
   *  a cached token or require explicit authentication. */
  authToken?: string;
  /** Optional custom fetch implementation (for Node.js environments, etc.). */
  fetch?: typeof fetch;
  /** Whether to automatically cache the JWT token in memory. Default true. */
  cacheToken?: boolean;
}

/* ─── Client class ─── */

export class FinchippayClient {
  private baseUrl: string;
  private authToken: string | null = null;
  private fetchFn: typeof fetch;
  private cacheToken: boolean;

  constructor(options: FinchippayClientOptions = {}) {
    this.baseUrl = (options.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.authToken = options.authToken || null;
    this.fetchFn = options.fetch || (globalThis as any).fetch;
    this.cacheToken = options.cacheToken ?? true;

    if (!this.fetchFn) {
      throw new Error(
        "Fetch API is not available. Pass a custom fetch implementation via the `fetch` option, or use Node.js 18+."
      );
    }
  }

  /* ─── Token management ─── */

  /** Returns the current JWT token, if any. */
  getToken(): string | null {
    return this.authToken;
  }

  /** Sets a new JWT token to use for subsequent requests. */
  setToken(token: string | null): void {
    this.authToken = token;
  }

  /** Clears the stored JWT token (logs out). */
  clearToken(): void {
    this.authToken = null;
  }

  /* ─── Core request method ─── */

  private async request<T>(
    method: string,
    path: string,
    options?: {
      body?: unknown;
      params?: Record<string, unknown>;
    }
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);

    // Attach query parameters
    if (options?.params) {
      for (const [key, value] of Object.entries(options.params)) {
        if (value !== undefined && value !== null) {
          url.searchParams.set(key, String(value));
        }
      }
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (this.authToken) {
      headers["Authorization"] = `Bearer ${this.authToken}`;
    }

    const res = await this.fetchFn(url.toString(), {
      method,
      headers,
      body: options?.body !== undefined ? JSON.stringify(options.body) : undefined,
    });

    if (!res.ok) {
      const errorBody = await res.text();
      let errorMessage: string;
      try {
        const parsed = JSON.parse(errorBody);
        errorMessage = parsed.error || parsed.message || errorBody;
      } catch {
        errorMessage = errorBody || `HTTP ${res.status}`;
      }
      throw new ApiHttpError(res.status, errorMessage, res.headers);
    }

    // Some endpoints return plain text (e.g. stellar.toml)
    const contentType = res.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      return (await res.json()) as T;
    }
    return (await res.text()) as unknown as T;
  }

  /* ─── SEP-0010 Authentication ─── */

  /**
   * SEP-0010 authentication flow:
   *  1. GET /api/auth?account=<publicKey>  → challenge transaction XDR
   *  2. (User signs the XDR with their Stellar keypair)
   *  3. POST /api/auth { transaction: <signedXDR> } → JWT token
   *
   * This method returns the challenge transaction. You must sign it
   * with the user's Stellar keypair (e.g. using @stellar/stellar-sdk)
   * and then call `verifyChallenge(signedXDR)`.
   */
  async getChallenge(account: string): Promise<ChallengeResponse> {
    const res = await this.request<SuccessResponse<ChallengeResponse>>("GET", "/api/auth", {
      params: { account },
    });
    return res.data || res;
  }

  /**
   * Submit a signed challenge transaction to obtain a JWT token.
   * The token is automatically stored in the client for subsequent requests.
   */
  async verifyChallenge(signedTransactionXDR: string): Promise<TokenResponse> {
    const body: AuthRequest = { transaction: signedTransactionXDR };
    const res = await this.request<SuccessResponse<TokenResponse> | TokenResponse>(
      "POST",
      "/api/auth",
      { body }
    );
    const data = "data" in res ? (res as SuccessResponse<TokenResponse>).data : (res as TokenResponse);
    if (this.cacheToken) {
      this.authToken = data.token;
    }
    return data;
  }

  /**
   * Convenience method: completes the full SEP-0010 flow.
   * `signedChallengeXDR` must be the challenge transaction XDR that has been
   * signed by the user's Stellar private key (e.g. via Freighter or @stellar/stellar-sdk).
   */
  async authenticate(account: string, signedChallengeXDR: string): Promise<string> {
    await this.getChallenge(account);
    const tokenRes = await this.verifyChallenge(signedChallengeXDR);
    return tokenRes.token;
  }

  /* ─── Health ─── */

  async health(): Promise<HealthStatus> {
    const res = await this.request<SuccessResponse<HealthStatus> | HealthStatus>("GET", "/health");
    return "data" in res ? (res as SuccessResponse<HealthStatus>).data : (res as HealthStatus);
  }

  /* ─── Accounts ─── */

  accounts = {
    /** Get account details and balances. */
    get: (publicKey: string): Promise<SuccessResponse<AccountInfo>> =>
      this.request("GET", `/api/accounts/${publicKey}`),

    /** Get native XLM balance. */
    getBalance: (publicKey: string): Promise<SuccessResponse<BalanceResponse>> =>
      this.request("GET", `/api/accounts/${publicKey}/balance`),

    /** Resolve a username to a Stellar public key. */
    resolveUsername: (username: string): Promise<SuccessResponse<ResolveUsernameResponse>> =>
      this.request("GET", `/api/accounts/resolve/${username}`),

    /** Register a username for an account. */
    register: (body: RegisterUsernameRequest): Promise<SuccessResponse<void>> =>
      this.request("POST", "/api/accounts/register", { body }),
  };

  /* ─── Payments ─── */

  payments = {
    /** Fetch payment history for an account. Supports pagination. */
    getHistory: (
      publicKey: string,
      params?: PaymentHistoryParams
    ): Promise<SuccessResponse<PaymentRecord[]>> =>
      this.request("GET", `/api/payments/${publicKey}`, { params: params as Record<string, unknown> }),

    /** Get aggregate payment statistics. */
    getStats: (publicKey: string): Promise<SuccessResponse<PaymentStats>> =>
      this.request("GET", `/api/payments/${publicKey}/stats`),
  };

  /* ─── Analytics ─── */

  analytics = {
    /** Get payment summary for an account. */
    getSummary: (publicKey: string): Promise<SuccessResponse<AnalyticsSummary>> =>
      this.request("GET", `/api/analytics/${publicKey}/summary`),

    /** Get top payment recipients. */
    getTopRecipients: (publicKey: string): Promise<SuccessResponse<TopRecipient[]>> =>
      this.request("GET", `/api/analytics/${publicKey}/top-recipients`),

    /** Get payment activity by day. */
    getActivity: (publicKey: string): Promise<SuccessResponse<ActivityDay[]>> =>
      this.request("GET", `/api/analytics/${publicKey}/activity`),
  };

  /* ─── Tips ─── */

  tips = {
    /** Get tips received by a creator. */
    getReceived: (creatorPublicKey: string): Promise<SuccessResponse<Tip[]>> =>
      this.request("GET", `/api/tips/received/${creatorPublicKey}`),

    /** Get tips sent by an account. */
    getSent: (senderPublicKey: string): Promise<SuccessResponse<Tip[]>> =>
      this.request("GET", `/api/tips/sent/${senderPublicKey}`),

    /** Get tip statistics for a creator. */
    getStats: (creatorPublicKey: string): Promise<SuccessResponse<TipStats>> =>
      this.request("GET", `/api/tips/stats/${creatorPublicKey}`),

    /** Record a new tip. */
    create: (body: CreateTipRequest): Promise<SuccessResponse<void>> =>
      this.request("POST", "/api/tips", { body }),
  };

  /* ─── Turrets (txFunctions) ─── */

  turrets = {
    /** List txFunction deployments. Optionally filter by owner. */
    list: (params?: TurretListParams): Promise<SuccessResponse<TxFunctionDeployment[]>> =>
      this.request("GET", "/api/turrets", { params: params as Record<string, unknown> }),

    /** Create a txFunction signing challenge. */
    createChallenge: (
      body: TxFunctionChallengeRequest
    ): Promise<SuccessResponse<TxFunctionChallengeResponse>> =>
      this.request("POST", "/api/turrets/challenge", { body }),

    /** Deploy a signed txFunction. */
    deploy: (body: TxFunctionDeployRequest): Promise<SuccessResponse<TxFunctionDeployment>> =>
      this.request("POST", "/api/turrets/deploy", { body }),

    /** Get a single txFunction deployment by ID. */
    get: (id: string): Promise<SuccessResponse<TxFunctionDeployment>> =>
      this.request("GET", `/api/turrets/${id}`),

    /** Get execution history for a deployment. */
    getHistory: (id: string): Promise<SuccessResponse<ExecutionLogEntry[]>> =>
      this.request("GET", `/api/turrets/${id}/history`),

    /** Pause a txFunction deployment. */
    pause: (id: string): Promise<SuccessResponse<void>> =>
      this.request("POST", `/api/turrets/${id}/pause`),

    /** Resume a paused txFunction deployment. */
    resume: (id: string): Promise<SuccessResponse<void>> =>
      this.request("POST", `/api/turrets/${id}/resume`),
  };

  /* ─── Scheduled Transactions ─── */

  scheduledTransactions = {
    /** Schedule a transaction for future submission. */
    schedule: (body: ScheduleTransactionRequest): Promise<SuccessResponse<void>> =>
      this.request("POST", "/api/scheduled-txns", { body }),

    /** List scheduled transactions for a public key. */
    list: (publicKey: string): Promise<ScheduledTransaction[]> =>
      this.request("GET", `/api/scheduled-txns/${publicKey}`),

    /** Cancel a scheduled transaction. */
    cancel: (id: number): Promise<SuccessResponse<void>> =>
      this.request("DELETE", `/api/scheduled-txns/${id}`),
  };

  /* ─── SEP-0024 ─── */

  sep24 = {
    /** Initiate an interactive deposit session. */
    initiateDeposit: (
      body: Sep24InitiateRequest
    ): Promise<Sep24InteractiveResponse> =>
      this.request("POST", "/api/sep24/transactions/deposit/interactive", { body }),

    /** Initiate an interactive withdrawal session. */
    initiateWithdrawal: (
      body: Sep24InitiateRequest
    ): Promise<Sep24InteractiveResponse> =>
      this.request("POST", "/api/sep24/transactions/withdraw/interactive", { body }),

    /** Poll transaction status by ID. */
    getTransaction: (id: string): Promise<{ transaction: Sep24Transaction }> =>
      this.request("GET", "/api/sep24/transaction", { params: { id } }),
  };

  /* ─── AI Parsing ─── */

  /** Parse natural language into a payment intent. */
  parsePayment = (
    body: ParsePaymentRequest
  ): Promise<ParsePaymentResponse> =>
    this.request("POST", "/api/parse-payment", { body });

  /* ─── Federation (SEP-0002) ─── */

  federation = {
    /** Resolve a stellar address to an account ID. */
    resolve: (
      q: string,
      type: "name" | "id"
    ): Promise<FederationRecord> =>
      this.request("GET", "/federation", { params: { q, type } }),

    /** Get the stellar.toml discovery document. */
    getStellarToml: (): Promise<string> =>
      this.request("GET", "/.well-known/stellar.toml"),
  };
}

/* ─── Error type ─── */

export class ApiHttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly headers?: Headers
  ) {
    super(message);
    this.name = "ApiHttpError";
  }

  /** Rate-limit headers returned by the server, if any. */
  get rateLimit(): { limit: number; remaining: number; reset: number } | null {
    if (!this.headers) return null;
    const limit = this.headers.get("RateLimit-Limit");
    const remaining = this.headers.get("RateLimit-Remaining");
    const reset = this.headers.get("RateLimit-Reset");
    if (limit && remaining && reset) {
      return {
        limit: Number(limit),
        remaining: Number(remaining),
        reset: Number(reset),
      };
    }
    return null;
  }

  /** Returns true if the error was caused by rate limiting (HTTP 429). */
  get isRateLimited(): boolean {
    return this.status === 429;
  }
}
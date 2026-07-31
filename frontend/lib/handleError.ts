/**
 * lib/handleError.ts
 * Turns any failure into something the UI can render (#270).
 *
 * `errorHandler.ts` answers "what went wrong" — it parses an API response into
 * a code and the catalogue's message. That message is written for developers.
 * This module answers "what do we tell the user, and what can they do about
 * it": a short title, a plain-language body, and a concrete recovery action.
 *
 * Usage:
 *   const handled = await handleApiError(response);
 *   toast(handled.title, handled.message);
 *   if (handled.action.kind === "retry") showRetryButton(handled.action.label);
 *
 *   // Non-HTTP failures (wallet, network) go through the same shape:
 *   const handled = handleError(err, "WALLET_SIGNATURE_REJECTED");
 */

import { getError, getErrorLayer } from "../../shared/errorCodes";
import {
  parseApiError,
  getContractErrorMessage,
  isRetryableError,
  isSupportError,
  type StandardError,
} from "./errorHandler";

// ─── Types ──────────────────────────────────────────────────────────────────

/**
 * What the user should do next.
 *
 *   retry       – transient; the same request may succeed if repeated.
 *   reconnect   – the wallet needs attention before anything else works.
 *   reauth      – the session is gone; sign the SEP-10 challenge again.
 *   fix_input   – the request was wrong; correct a field and resubmit.
 *   wait        – rate limited or paused; the only option is to wait.
 *   fund        – the account needs XLM before the action can succeed.
 *   contact_support – nothing the user can do; escalate with the correlation ID.
 *   none        – informational; no recovery step applies.
 */
export type RecoveryKind =
  | "retry"
  | "reconnect"
  | "reauth"
  | "fix_input"
  | "wait"
  | "fund"
  | "contact_support"
  | "none";

export interface RecoveryAction {
  kind: RecoveryKind;
  /** Button or link text, e.g. "Try again". */
  label: string;
}

export interface HandledError extends StandardError {
  /** Short heading, e.g. "Wallet not connected". */
  title: string;
  /** Plain-language explanation aimed at the end user. */
  userMessage: string;
  action: RecoveryAction;
  /** Which layer produced the error: api, contract, frontend, or shared. */
  layer: string;
  /** Present when the backend returned one; quote it in support requests. */
  correlationId?: string;
  /** True when retrying the same request is worth offering. */
  retryable: boolean;
}

// ─── Recovery actions ───────────────────────────────────────────────────────

const ACTIONS: Record<RecoveryKind, RecoveryAction> = {
  retry: { kind: "retry", label: "Try again" },
  reconnect: { kind: "reconnect", label: "Connect wallet" },
  reauth: { kind: "reauth", label: "Sign in again" },
  fix_input: { kind: "fix_input", label: "Review and edit" },
  wait: { kind: "wait", label: "Wait and retry" },
  fund: { kind: "fund", label: "Add funds" },
  contact_support: { kind: "contact_support", label: "Contact support" },
  none: { kind: "none", label: "Dismiss" },
};

/**
 * User-facing copy per error code. Only codes a user can actually encounter and
 * act on are listed; anything else falls through to a category default, so the
 * table never has to be exhaustive to stay correct.
 */
const USER_COPY: Record<
  string,
  { title: string; message: string; action: RecoveryKind }
> = {
  // ── Auth ────────────────────────────────────────────────────────────────
  AUTH_MISSING_TOKEN: {
    title: "Sign in required",
    message: "Connect your wallet and sign in to continue.",
    action: "reauth",
  },
  AUTH_EXPIRED_TOKEN: {
    title: "Session expired",
    message: "Your session timed out. Sign in again to continue.",
    action: "reauth",
  },
  TOKEN_EXPIRED: {
    title: "Session expired",
    message: "Your session timed out. Sign in again to continue.",
    action: "reauth",
  },
  AUTH_INVALID_TOKEN: {
    title: "Session invalid",
    message: "We could not verify your session. Sign in again to continue.",
    action: "reauth",
  },
  AUTH_MISSING_HEADER: {
    title: "Sign in required",
    message: "Connect your wallet and sign in to continue.",
    action: "reauth",
  },
  AUTH_FORBIDDEN: {
    title: "Not allowed",
    message: "This account does not have access to that data.",
    action: "none",
  },
  AUTH_CHALLENGE_FAILED: {
    title: "Could not verify your wallet",
    message:
      "The signature did not match your account. Make sure the right account is selected in your wallet, then try again.",
    action: "reconnect",
  },

  // ── Validation ──────────────────────────────────────────────────────────
  VAL_INVALID_PUBLIC_KEY: {
    title: "Invalid address",
    message:
      "That is not a valid Stellar address. It should be 56 characters and start with G.",
    action: "fix_input",
  },
  VAL_INVALID_STELLAR_ADDRESS: {
    title: "Invalid address",
    message: "Check the recipient address and try again.",
    action: "fix_input",
  },
  VAL_INVALID_AMOUNT: {
    title: "Invalid amount",
    message: "Enter an amount greater than zero.",
    action: "fix_input",
  },
  VAL_MISSING_FIELD: {
    title: "Missing information",
    message: "Some required details are missing. Fill them in and try again.",
    action: "fix_input",
  },
  VAL_MEMO_TOO_LONG: {
    title: "Memo too long",
    message: "Memos are limited to 28 bytes. Shorten it and try again.",
    action: "fix_input",
  },
  VAL_INVALID_USERNAME: {
    title: "Invalid username",
    message:
      "Usernames must be 3 to 20 characters, using only letters and numbers.",
    action: "fix_input",
  },
  VAL_BODY_TOO_LARGE: {
    title: "Request too large",
    message: "That request is too big to process. Try sending less at once.",
    action: "fix_input",
  },

  // ── Resources ───────────────────────────────────────────────────────────
  RES_ACCOUNT_NOT_FOUND: {
    title: "Account not funded",
    message:
      "This Stellar account does not exist yet. It needs a starting balance of at least 1 XLM.",
    action: "fund",
  },
  RES_NOT_FOUND: {
    title: "Not found",
    message: "We could not find what you were looking for.",
    action: "none",
  },
  RES_USERNAME_CONFLICT: {
    title: "Username taken",
    message: "That username is already registered. Pick another one.",
    action: "fix_input",
  },
  RES_PUBLIC_KEY_CONFLICT: {
    title: "Address already registered",
    message: "This address is already linked to a different username.",
    action: "none",
  },

  // ── Rate limiting ───────────────────────────────────────────────────────
  RATE_LIMITED_GLOBAL: {
    title: "Too many requests",
    message: "You are going a little fast. Wait a moment and try again.",
    action: "wait",
  },
  RATE_LIMITED_SENSITIVE: {
    title: "Too many requests",
    message: "Wait about a minute before trying that again.",
    action: "wait",
  },
  RATE_LIMITED_USER: {
    title: "Too many requests",
    message: "This account has made too many requests. Wait a moment.",
    action: "wait",
  },

  // ── Payments ────────────────────────────────────────────────────────────
  PAY_INSUFFICIENT_BALANCE: {
    title: "Not enough balance",
    message:
      "Your balance will not cover this payment plus the network fee and reserve.",
    action: "fund",
  },
  PAY_DESTINATION_NOT_FUNDED: {
    title: "Recipient account not created",
    message:
      "This address has no Stellar account yet. Send at least 1 XLM to create it.",
    action: "fix_input",
  },
  PAY_SELF_PAYMENT: {
    title: "Cannot pay yourself",
    message: "Choose a different recipient.",
    action: "fix_input",
  },
  PAY_INVALID_DESTINATION: {
    title: "Invalid recipient",
    message: "Check the recipient address and try again.",
    action: "fix_input",
  },
  PAY_CONFIRMATION_TIMEOUT: {
    title: "Still confirming",
    message:
      "The network is taking longer than usual. Check your transaction history before sending again.",
    action: "retry",
  },
  PAY_SUBMIT_FAILED: {
    title: "Payment not sent",
    message: "The network rejected the transaction. Nothing was transferred.",
    action: "retry",
  },
  PAY_HORIZON_ERROR: {
    title: "Stellar network error",
    message: "The Stellar network returned an error. Try again shortly.",
    action: "retry",
  },

  // ── Contract ────────────────────────────────────────────────────────────
  CONTRACT_UNAUTHORIZED: {
    title: "Not allowed",
    message: "This account is not permitted to perform that on-chain action.",
    action: "none",
  },
  CONTRACT_NOT_FOUND: {
    title: "Not found on-chain",
    message: "That escrow, stream, or proposal does not exist.",
    action: "none",
  },
  CONTRACT_INVALID_STATE: {
    title: "Cannot do that yet",
    message:
      "This action is not available in the current state. Refresh to see the latest status.",
    action: "retry",
  },
  CONTRACT_INSUFFICIENT_FUNDS: {
    title: "Not enough deposited",
    message: "There are not enough deposited funds for this action.",
    action: "fund",
  },
  CONTRACT_PAUSED: {
    title: "Temporarily paused",
    message: "This contract is paused for maintenance. Try again later.",
    action: "wait",
  },
  CONTRACT_PROPOSAL_EXPIRED: {
    title: "Proposal expired",
    message: "This proposal can no longer be approved. Create a new one.",
    action: "none",
  },
  CONTRACT_ALREADY_SIGNED: {
    title: "Already approved",
    message: "You have already approved this proposal.",
    action: "none",
  },
  CONTRACT_RELEASE_LEDGER_IN_PAST: {
    title: "Release time already passed",
    message: "Pick a release time in the future.",
    action: "fix_input",
  },

  // ── Wallet (frontend layer) ─────────────────────────────────────────────
  WALLET_NOT_INSTALLED: {
    title: "Wallet not found",
    message:
      "Freighter is not installed in this browser. Install it from freighter.app, then reload this page.",
    action: "reconnect",
  },
  WALLET_NOT_CONNECTED: {
    title: "Wallet not connected",
    message: "Connect a wallet to continue.",
    action: "reconnect",
  },
  WALLET_CONNECTION_REJECTED: {
    title: "Connection declined",
    message: "You declined the connection. Approve it in Freighter to continue.",
    action: "reconnect",
  },
  WALLET_SIGNATURE_REJECTED: {
    title: "Signature declined",
    message: "You declined the signature, so nothing was sent.",
    action: "retry",
  },
  WALLET_NETWORK_MISMATCH: {
    title: "Wrong network",
    message:
      "Your wallet is on a different Stellar network than this app. Switch networks in Freighter.",
    action: "reconnect",
  },
  WALLET_ACCOUNT_MISMATCH: {
    title: "Different account selected",
    message:
      "Freighter has a different account selected than the one active here. Switch account and try again.",
    action: "reconnect",
  },
  WALLET_LOCKED: {
    title: "Wallet locked",
    message: "Unlock Freighter and try again.",
    action: "reconnect",
  },

  // ── Server / generic ────────────────────────────────────────────────────
  SRV_INTERNAL: {
    title: "Something went wrong",
    message:
      "We hit an unexpected problem. Try again, and quote the reference below if it keeps happening.",
    action: "contact_support",
  },
  SRV_HORIZON_UNAVAILABLE: {
    title: "Stellar network unavailable",
    message: "The Stellar network is not responding. Try again shortly.",
    action: "retry",
  },
  SRV_NOT_IMPLEMENTED: {
    title: "Not available",
    message: "This feature is not enabled on this deployment.",
    action: "none",
  },
  GEN_NETWORK_ERROR: {
    title: "Connection problem",
    message: "We could not reach the server. Check your connection.",
    action: "retry",
  },
  GEN_OFFLINE: {
    title: "You are offline",
    message: "Reconnect to the internet to continue.",
    action: "retry",
  },
};

/**
 * Fallback copy per category prefix, used when a code has no bespoke entry.
 * This is why the table above does not need to list all 75 codes.
 */
const CATEGORY_FALLBACK: Record<
  string,
  { title: string; action: RecoveryKind }
> = {
  AUTH: { title: "Sign in required", action: "reauth" },
  TOKEN: { title: "Sign in required", action: "reauth" },
  VAL: { title: "Check your details", action: "fix_input" },
  RES: { title: "Not found", action: "none" },
  RATE: { title: "Too many requests", action: "wait" },
  CONTRACT: { title: "On-chain action failed", action: "none" },
  PAY: { title: "Payment problem", action: "retry" },
  SRV: { title: "Service problem", action: "retry" },
  WALLET: { title: "Wallet problem", action: "reconnect" },
  GEN: { title: "Something went wrong", action: "retry" },
};

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Build a `HandledError` from an error code and optional context.
 *
 * @param code - A catalogue code, e.g. "PAY_INSUFFICIENT_BALANCE".
 * @param context - Optional details and the correlation ID from the API.
 */
export function describeError(
  code: string,
  context: { details?: unknown; correlationId?: string; message?: string } = {}
): HandledError {
  const entry = getError(code);
  const copy = USER_COPY[entry.code];
  const prefix = entry.code.split("_")[0];
  const fallback = CATEGORY_FALLBACK[prefix] ?? {
    title: "Something went wrong",
    action: "retry" as RecoveryKind,
  };

  // Support wins over the mapped action: if there is nothing the user can do,
  // offering "Try again" only wastes their time.
  const actionKind = copy?.action ?? fallback.action;
  const action =
    ACTIONS[
      isSupportError(entry.code) && actionKind === "retry"
        ? "contact_support"
        : actionKind
    ];

  return {
    code: entry.code,
    // The technical message, for logs and error reporting.
    message: context.message || entry.message,
    details: context.details,
    title: copy?.title ?? fallback.title,
    // Falls back to the catalogue message so an unmapped code still reads as a
    // sentence rather than as an empty string.
    userMessage: copy?.message ?? entry.message,
    action,
    layer: getErrorLayer(entry.code),
    correlationId: context.correlationId,
    retryable: isRetryableError(entry.code),
  };
}

/**
 * Parse a failed API response and describe it for the user.
 *
 * @param response - The fetch Response for a non-2xx request.
 */
export async function handleApiError(response: Response): Promise<HandledError> {
  const parsed = await parseApiError(response);

  return describeError(parsed.code, {
    details: parsed.details,
    message: parsed.message,
    correlationId: parsed.correlationId,
  });
}

/**
 * Describe an arbitrary thrown value — a wallet rejection, a network failure, a
 * plain Error. Use `fallbackCode` to say what this call site means when it
 * cannot tell, e.g. "WALLET_SIGNATURE_REJECTED" around a signing call.
 *
 * @param error - The caught value.
 * @param fallbackCode - Code to assume when nothing more specific is inferable.
 */
export function handleError(
  error: unknown,
  fallbackCode = "GEN_UNKNOWN"
): HandledError {
  if (error && typeof error === "object") {
    const candidate = error as {
      code?: unknown;
      correlationId?: unknown;
      message?: unknown;
    };

    if (typeof candidate.code === "string") {
      return describeError(candidate.code, {
        correlationId:
          typeof candidate.correlationId === "string"
            ? candidate.correlationId
            : undefined,
        message:
          typeof candidate.message === "string" ? candidate.message : undefined,
      });
    }
  }

  const rawMessage = error instanceof Error ? error.message : String(error ?? "");
  const inferred = inferCodeFromMessage(rawMessage);

  return describeError(inferred ?? fallbackCode, {
    message: rawMessage || undefined,
  });
}

/**
 * Describe a numeric Soroban ContractError (1-17) for the user.
 *
 * @param contractErrorCode - The numeric ContractError value.
 * @param rawMessage - Optional raw message from the invocation.
 */
export function handleContractError(
  contractErrorCode: number,
  rawMessage?: string
): HandledError {
  const parsed = getContractErrorMessage(contractErrorCode, rawMessage);
  return describeError(parsed.code, { details: parsed.details });
}

/**
 * One-line string for toasts and inline banners, with the correlation ID
 * appended when there is one worth quoting to support.
 */
export function formatForDisplay(handled: HandledError): string {
  if (handled.action.kind === "contact_support" && handled.correlationId) {
    return `${handled.userMessage} (reference: ${handled.correlationId})`;
  }
  return handled.userMessage;
}

// ─── Private helpers ────────────────────────────────────────────────────────

/**
 * Recognise the handful of failures that reach us only as free text — wallet
 * extensions and `fetch` do not use our codes.
 */
function inferCodeFromMessage(message: string): string | null {
  if (!message) return null;
  const text = message.toLowerCase();

  if (text.includes("user declined") || text.includes("user rejected")) {
    return "WALLET_SIGNATURE_REJECTED";
  }
  if (text.includes("not installed") || text.includes("freighter is not")) {
    return "WALLET_NOT_INSTALLED";
  }
  if (text.includes("wallet is locked") || text.includes("unlock")) {
    return "WALLET_LOCKED";
  }
  if (text.includes("failed to fetch") || text.includes("network request failed")) {
    return "GEN_NETWORK_ERROR";
  }
  if (text.includes("offline")) {
    return "GEN_OFFLINE";
  }
  return null;
}

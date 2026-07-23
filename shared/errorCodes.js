/**
 * shared/errorCodes.js
 * Canonical error code registry for Finchippay Solution.
 *
 * Every API error response follows the shape:
 *   { error: { code: string, message: string, details?: any } }
 *
 * This module provides:
 *   - ERROR_CODES: the full catalogue keyed by code string.
 *   - getError(code): lookup helper returning { code, httpStatus, message }.
 *   - formatErrorResponse(code, details?): builds the canonical error body.
 *   - CONTRACT_ERROR_MAP: maps numeric ContractError values → error codes.
 *
 * Usage (backend):
 *   const { formatErrorResponse, ERROR_CODES } = require("../../shared/errorCodes");
 *   res.status(ERROR_CODES.VAL_INVALID_PUBLIC_KEY.httpStatus)
 *      .json(formatErrorResponse("VAL_INVALID_PUBLIC_KEY"));
 *
 * Usage (frontend):
 *   import { ERROR_CODES, getError } from "../shared/errorCodes";
 *   const err = getError("RES_NOT_FOUND");
 */

"use strict";

// ─── Error category prefixes ─────────────────────────────────────────────────
//   AUTH_*    – Authentication / authorization errors
//   VAL_*     – Input validation errors
//   RES_*     – Resource lifecycle errors (not found, conflict, gone)
//   RATE_*    – Rate limiting errors
//   CONTRACT_*– On-chain contract errors (mapped from numeric ContractError)
//   PAY_*     – Payment / transaction errors
//   SRV_*     – Server / infrastructure errors
//   GEN_*     – Generic / catch-all errors

const ERROR_CODES = {
  // ── Auth errors ──────────────────────────────────────────────────────────
  AUTH_MISSING_TOKEN: {
    code: "AUTH_MISSING_TOKEN",
    httpStatus: 401,
    message: "Authentication token is required.",
  },
  AUTH_EXPIRED_TOKEN: {
    code: "AUTH_EXPIRED_TOKEN",
    httpStatus: 401,
    message: "Token has expired. Please re-authenticate.",
  },
  AUTH_INVALID_TOKEN: {
    code: "AUTH_INVALID_TOKEN",
    httpStatus: 401,
    message: "Token is invalid or malformed.",
  },
  AUTH_MISSING_HEADER: {
    code: "AUTH_MISSING_HEADER",
    httpStatus: 401,
    message:
      "Missing or invalid Authorization header. Expected 'Bearer <token>'.",
  },
  AUTH_FORBIDDEN: {
    code: "AUTH_FORBIDDEN",
    httpStatus: 403,
    message: "You do not have permission to access this resource.",
  },
  AUTH_CHALLENGE_FAILED: {
    code: "AUTH_CHALLENGE_FAILED",
    httpStatus: 401,
    message: "SEP-0010 challenge verification failed.",
  },

  // ── Validation errors ────────────────────────────────────────────────────
  VAL_INVALID_PUBLIC_KEY: {
    code: "VAL_INVALID_PUBLIC_KEY",
    httpStatus: 400,
    message: "Invalid Stellar public key format.",
  },
  VAL_INVALID_AMOUNT: {
    code: "VAL_INVALID_AMOUNT",
    httpStatus: 400,
    message: "Amount must be a positive number.",
  },
  VAL_MISSING_FIELD: {
    code: "VAL_MISSING_FIELD",
    httpStatus: 400,
    message: "Required field is missing.",
  },
  VAL_INVALID_JSON: {
    code: "VAL_INVALID_JSON",
    httpStatus: 400,
    message: "Request body contains invalid JSON.",
  },
  VAL_BODY_TOO_LARGE: {
    code: "VAL_BODY_TOO_LARGE",
    httpStatus: 413,
    message: "Request body exceeds the maximum allowed size.",
  },
  VAL_CONTENT_TYPE: {
    code: "VAL_CONTENT_TYPE",
    httpStatus: 415,
    message: "Content-Type must be application/json.",
  },
  VAL_INVALID_USERNAME: {
    code: "VAL_INVALID_USERNAME",
    httpStatus: 400,
    message: "Username must be 3–20 characters and contain only letters and numbers.",
  },
  VAL_INVALID_STELLAR_ADDRESS: {
    code: "VAL_INVALID_STELLAR_ADDRESS",
    httpStatus: 400,
    message: "Invalid Stellar address format.",
  },
  VAL_INVALID_URL: {
    code: "VAL_INVALID_URL",
    httpStatus: 400,
    message: "Invalid URL format.",
  },
  VAL_INVALID_DATE: {
    code: "VAL_INVALID_DATE",
    httpStatus: 400,
    message: "Invalid date format. Provide a valid ISO 8601 date string.",
  },
  VAL_MEMO_TOO_LONG: {
    code: "VAL_MEMO_TOO_LONG",
    httpStatus: 400,
    message: "Memo exceeds the maximum of 28 bytes.",
  },
  VAL_WEAK_SECRET: {
    code: "VAL_WEAK_SECRET",
    httpStatus: 400,
    message: "Secret must be at least 8 characters for HMAC-SHA256 security.",
  },
  VAL_INVALID_LIMIT: {
    code: "VAL_INVALID_LIMIT",
    httpStatus: 400,
    message: "Limit must be a positive integer.",
  },
  VAL_INVALID_FEDERATION_TYPE: {
    code: "VAL_INVALID_FEDERATION_TYPE",
    httpStatus: 400,
    message: "Invalid type parameter. Must be 'name' or 'id'.",
  },

  // ── Resource errors ──────────────────────────────────────────────────────
  RES_NOT_FOUND: {
    code: "RES_NOT_FOUND",
    httpStatus: 404,
    message: "The requested resource was not found.",
  },
  RES_ACCOUNT_NOT_FOUND: {
    code: "RES_ACCOUNT_NOT_FOUND",
    httpStatus: 404,
    message:
      "Account not found. It may not be funded yet. Use Friendbot on testnet.",
  },
  RES_CONFLICT: {
    code: "RES_CONFLICT",
    httpStatus: 409,
    message: "Resource already exists.",
  },
  RES_USERNAME_CONFLICT: {
    code: "RES_USERNAME_CONFLICT",
    httpStatus: 409,
    message: "Username already registered.",
  },
  RES_PUBLIC_KEY_CONFLICT: {
    code: "RES_PUBLIC_KEY_CONFLICT",
    httpStatus: 409,
    message: "Public key already registered to another username.",
  },
  RES_GONE: {
    code: "RES_GONE",
    httpStatus: 410,
    message: "The resource is no longer available.",
  },
  RES_ROUTE_NOT_FOUND: {
    code: "RES_ROUTE_NOT_FOUND",
    httpStatus: 404,
    message: "Route not found.",
  },

  // ── Rate limiting ────────────────────────────────────────────────────────
  RATE_LIMITED_GLOBAL: {
    code: "RATE_LIMITED_GLOBAL",
    httpStatus: 429,
    message: "Too many requests. Please try again later.",
  },
  RATE_LIMITED_SENSITIVE: {
    code: "RATE_LIMITED_SENSITIVE",
    httpStatus: 429,
    message: "Too many requests to sensitive routes. Please wait 1 minute.",
  },
  RATE_LIMITED_USER: {
    code: "RATE_LIMITED_USER",
    httpStatus: 429,
    message: "Too many requests from this account.",
  },

  // ── Contract errors (mapped from numeric ContractError) ──────────────────
  CONTRACT_ALREADY_INITIALIZED: {
    code: "CONTRACT_ALREADY_INITIALIZED",
    httpStatus: 409,
    message: "Contract is already initialized.",
  },
  CONTRACT_UNAUTHORIZED: {
    code: "CONTRACT_UNAUTHORIZED",
    httpStatus: 403,
    message: "You are not authorized for this action.",
  },
  CONTRACT_NON_POSITIVE_AMOUNT: {
    code: "CONTRACT_NON_POSITIVE_AMOUNT",
    httpStatus: 400,
    message: "Amount must be strictly positive.",
  },
  CONTRACT_RELEASE_LEDGER_IN_PAST: {
    code: "CONTRACT_RELEASE_LEDGER_IN_PAST",
    httpStatus: 400,
    message: "Release ledger must be in the future.",
  },
  CONTRACT_NOT_FOUND: {
    code: "CONTRACT_NOT_FOUND",
    httpStatus: 404,
    message: "The contract resource (escrow, stream, proposal) was not found.",
  },
  CONTRACT_INVALID_STATE: {
    code: "CONTRACT_INVALID_STATE",
    httpStatus: 409,
    message: "Operation not valid in the current state.",
  },
  CONTRACT_OVERFLOW: {
    code: "CONTRACT_OVERFLOW",
    httpStatus: 500,
    message: "Arithmetic overflow in contract operation.",
  },
  CONTRACT_INVALID_THRESHOLD: {
    code: "CONTRACT_INVALID_THRESHOLD",
    httpStatus: 400,
    message: "Signer list length does not match threshold.",
  },
  CONTRACT_LENGTH_MISMATCH: {
    code: "CONTRACT_LENGTH_MISMATCH",
    httpStatus: 400,
    message: "Array lengths do not match.",
  },
  CONTRACT_ALREADY_SIGNED: {
    code: "CONTRACT_ALREADY_SIGNED",
    httpStatus: 409,
    message: "Address has already approved this proposal.",
  },
  CONTRACT_INSUFFICIENT_FUNDS: {
    code: "CONTRACT_INSUFFICIENT_FUNDS",
    httpStatus: 400,
    message: "Insufficient deposited funds.",
  },
  CONTRACT_PAUSED: {
    code: "CONTRACT_PAUSED",
    httpStatus: 503,
    message: "Contract is temporarily paused.",
  },
  CONTRACT_SELF_TRANSFER: {
    code: "CONTRACT_SELF_TRANSFER",
    httpStatus: 400,
    message: "Cannot transfer to yourself.",
  },
  CONTRACT_BATCH_TOO_LARGE: {
    code: "CONTRACT_BATCH_TOO_LARGE",
    httpStatus: 400,
    message: "Batch size exceeds maximum allowed.",
  },
  CONTRACT_DUPLICATE_SIGNER: {
    code: "CONTRACT_DUPLICATE_SIGNER",
    httpStatus: 400,
    message: "Duplicate signer in signers list.",
  },
  CONTRACT_PROPOSAL_EXPIRED: {
    code: "CONTRACT_PROPOSAL_EXPIRED",
    httpStatus: 410,
    message: "Proposal has expired and can no longer be approved.",
  },
  CONTRACT_TRANSFER_FAILED: {
    code: "CONTRACT_TRANSFER_FAILED",
    httpStatus: 502,
    message: "Token transfer could not be verified on-chain.",
  },

  // ── Payment / transaction errors ─────────────────────────────────────────
  PAY_BUILD_FAILED: {
    code: "PAY_BUILD_FAILED",
    httpStatus: 500,
    message: "Failed to build the payment transaction.",
  },
  PAY_SIGN_FAILED: {
    code: "PAY_SIGN_FAILED",
    httpStatus: 400,
    message: "Failed to sign the transaction.",
  },
  PAY_SUBMIT_FAILED: {
    code: "PAY_SUBMIT_FAILED",
    httpStatus: 502,
    message: "Failed to submit the transaction to the Stellar network.",
  },
  PAY_CONFIRMATION_TIMEOUT: {
    code: "PAY_CONFIRMATION_TIMEOUT",
    httpStatus: 504,
    message: "Transaction confirmation timed out.",
  },
  PAY_INSUFFICIENT_BALANCE: {
    code: "PAY_INSUFFICIENT_BALANCE",
    httpStatus: 400,
    message: "Insufficient balance for this transaction.",
  },
  PAY_SELF_PAYMENT: {
    code: "PAY_SELF_PAYMENT",
    httpStatus: 400,
    message: "Cannot send payment to your own wallet.",
  },
  PAY_DESTINATION_NOT_FUNDED: {
    code: "PAY_DESTINATION_NOT_FUNDED",
    httpStatus: 400,
    message:
      "Destination account does not exist. Send at least 1 XLM to create it.",
  },
  PAY_INVALID_DESTINATION: {
    code: "PAY_INVALID_DESTINATION",
    httpStatus: 400,
    message: "Invalid payment destination.",
  },
  PAY_HORIZON_ERROR: {
    code: "PAY_HORIZON_ERROR",
    httpStatus: 502,
    message: "Stellar Horizon returned an error.",
  },

  // ── Server / infrastructure errors ───────────────────────────────────────
  SRV_INTERNAL: {
    code: "SRV_INTERNAL",
    httpStatus: 500,
    message: "An internal server error occurred.",
  },
  SRV_HORIZON_UNAVAILABLE: {
    code: "SRV_HORIZON_UNAVAILABLE",
    httpStatus: 502,
    message: "Stellar Horizon is temporarily unavailable.",
  },
  SRV_FEDERATION_FAILED: {
    code: "SRV_FEDERATION_FAILED",
    httpStatus: 502,
    message: "External federation resolution failed.",
  },
  SRV_AI_NOT_CONFIGURED: {
    code: "SRV_AI_NOT_CONFIGURED",
    httpStatus: 501,
    message: "AI payment parsing is not configured.",
  },
  SRV_METRICS_FAILED: {
    code: "SRV_METRICS_FAILED",
    httpStatus: 500,
    message: "Failed to collect Prometheus metrics.",
  },
  SRV_NOT_IMPLEMENTED: {
    code: "SRV_NOT_IMPLEMENTED",
    httpStatus: 501,
    message: "This feature is not yet implemented.",
  },

  // ── Generic / catch-all ──────────────────────────────────────────────────
  GEN_UNKNOWN: {
    code: "GEN_UNKNOWN",
    httpStatus: 500,
    message: "An unexpected error occurred.",
  },
  GEN_NETWORK_ERROR: {
    code: "GEN_NETWORK_ERROR",
    httpStatus: 0,
    message: "Network error. Please check your connection.",
  },
  GEN_OFFLINE: {
    code: "GEN_OFFLINE",
    httpStatus: 0,
    message: "You are offline. Please check your connection.",
  },
};

// ─── Contract error code → error code mapping ──────────────────────────────

/**
 * Maps the numeric ContractError codes (1–17) from the Soroban contract
 * to their corresponding ERROR_CODES keys.
 *
 * @type {Record<number, string>}
 */
const CONTRACT_ERROR_MAP = {
  1: "CONTRACT_ALREADY_INITIALIZED",
  2: "CONTRACT_UNAUTHORIZED",
  3: "CONTRACT_NON_POSITIVE_AMOUNT",
  4: "CONTRACT_RELEASE_LEDGER_IN_PAST",
  5: "CONTRACT_NOT_FOUND",
  6: "CONTRACT_INVALID_STATE",
  7: "CONTRACT_OVERFLOW",
  8: "CONTRACT_INVALID_THRESHOLD",
  9: "CONTRACT_LENGTH_MISMATCH",
  10: "CONTRACT_ALREADY_SIGNED",
  11: "CONTRACT_INSUFFICIENT_FUNDS",
  12: "CONTRACT_PAUSED",
  13: "CONTRACT_SELF_TRANSFER",
  14: "CONTRACT_BATCH_TOO_LARGE",
  15: "CONTRACT_DUPLICATE_SIGNER",
  16: "CONTRACT_PROPOSAL_EXPIRED",
  17: "CONTRACT_TRANSFER_FAILED",
};

// ─── Helpers ───────────────────────────────────────────────────────────────

/**
 * Look up an error code from the registry.
 * Falls back to GEN_UNKNOWN if the code is not registered.
 *
 * @param {string} code - Error code key (e.g. "AUTH_MISSING_TOKEN")
 * @returns {{ code: string, httpStatus: number, message: string }}
 */
function getError(code) {
  return ERROR_CODES[code] || ERROR_CODES.GEN_UNKNOWN;
}

/**
 * Build the canonical API error response body.
 *
 * @param {string} code - Error code key (e.g. "VAL_INVALID_AMOUNT")
 * @param {*} [details] - Optional extra data (field name, validation issues, etc.)
 * @returns {{ error: { code: string, message: string, details?: any } }}
 */
function formatErrorResponse(code, details) {
  const entry = getError(code);
  const body = { error: { code: entry.code, message: entry.message } };
  if (details !== undefined) {
    body.error.details = details;
  }
  return body;
}

/**
 * Map a numeric contract error code to the canonical error code key.
 *
 * @param {number} contractErrCode - The numeric ContractError value (1–17)
 * @returns {string} Error code key (e.g. "CONTRACT_UNAUTHORIZED")
 */
function getContractErrorCode(contractErrCode) {
  if (typeof contractErrCode !== "number" || !Number.isFinite(contractErrCode)) {
    return "GEN_UNKNOWN";
  }
  return CONTRACT_ERROR_MAP[contractErrCode] || "GEN_UNKNOWN";
}

/**
 * Build an error response from a numeric contract error code.
 *
 * @param {number} contractErrCode - The numeric ContractError value
 * @param {*} [details] - Optional extra data
 * @returns {{ error: { code: string, message: string, details?: any } }}
 */
function formatContractErrorResponse(contractErrCode, details) {
  const code = getContractErrorCode(contractErrCode);
  return formatErrorResponse(code, details);
}

module.exports = {
  ERROR_CODES,
  CONTRACT_ERROR_MAP,
  getError,
  formatErrorResponse,
  getContractErrorCode,
  formatContractErrorResponse,
};

/**
 * lib/errorHandler.ts
 * Frontend error handling utilities for Finchippay Solution.
 *
 * Provides:
 *   - parseApiError(response: Response): StandardError — extract error code and
 *     message from API responses following the canonical { error: { code, message, details? } } shape.
 *   - getContractErrorMessage(contractErrorCode: number): StandardError — maps
 *     numeric ContractError codes to human-friendly messages.
 *   - getErrorMessage(errorCode: string): StandardError — look up any error code.
 */

import {
  ERROR_CODES,
  getError,
  getContractErrorCode,
} from "../../shared/errorCodes";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface StandardError {
  code: string;
  message: string;
  details?: unknown;
  /**
   * Request correlation ID from the API, matching the `X-Request-ID` response
   * header and the server logs. Absent for errors raised client-side (#270).
   */
  correlationId?: string;
}

export interface ApiErrorResponse {
  error?: {
    code?: string;
    message?: string;
    correlationId?: string;
    details?: unknown;
  };
  // Legacy fallback shapes (in transition)
  message?: string;
  errorString?: string;
}

// ─── Retryable error codes ──────────────────────────────────────────────────

/**
 * Error codes for which an automatic or manual retry is reasonable.
 * These typically indicate transient server/network conditions rather
 * than bad input.
 */
const RETRYABLE_ERROR_CODES = new Set([
  "SRV_INTERNAL",
  "SRV_HORIZON_UNAVAILABLE",
  "SRV_FEDERATION_FAILED",
  "RATE_LIMITED_GLOBAL",
  "RATE_LIMITED_SENSITIVE",
  "RATE_LIMITED_USER",
  "PAY_CONFIRMATION_TIMEOUT",
  "PAY_HORIZON_ERROR",
  "GEN_NETWORK_ERROR",
  "CONTRACT_PAUSED",
  "CONTRACT_TRANSFER_FAILED",
]);

/**
 * Error codes where a `Contact Support` suggestion is more appropriate
 * than a retry.
 */
const SUPPORT_ERROR_CODES = new Set([
  "SRV_INTERNAL",
  "CONTRACT_OVERFLOW",
  "CONTRACT_TRANSFER_FAILED",
  "PAY_HORIZON_ERROR",
]);

// ─── Main API ───────────────────────────────────────────────────────────────

/**
 * Parse a fetch Response into a StandardError.
 *
 * Tries the canonical { error: { code, message, details? } } shape first,
 * then falls back to legacy { error: "..." } or { message: "..." } shapes,
 * and finally to a generic error if the response fails to parse.
 *
 * @param response - A fetch Response object (can be from failed or successful call)
 * @returns StandardError with code, message, and optional details.
 */
export async function parseApiError(
  response: Response,
): Promise<StandardError> {
  let body: ApiErrorResponse | null = null;

  try {
    body = await response.json();
  } catch {
    // Response body is not JSON → synthesise from HTTP status.
    return synthesizeFromStatus(response.status);
  }

  if (!body) {
    return synthesizeFromStatus(response.status);
  }

  // Canonical shape: { error: { code, message, correlationId?, details? } }
  if (body.error && typeof body.error === "object") {
    const apiErr = body.error as {
      code?: string;
      message?: string;
      correlationId?: string;
      details?: unknown;
    };
    const code = apiErr.code || codeFromHttpStatus(response.status);
    const resolved = getError(code);
    return {
      code: resolved.code,
      message: apiErr.message || resolved.message,
      details: apiErr.details,
      // Fall back to the header: it is set even when the body predates #270.
      correlationId:
        apiErr.correlationId ||
        response.headers?.get?.("X-Request-ID") ||
        undefined,
    };
  }

  // Legacy shape: { error: "string message" }
  if (typeof body.error === "string") {
    const code = codeFromHttpStatus(response.status);
    return {
      code,
      message: body.error,
    };
  }

  // Legacy shape: { message: "..." }
  if (typeof body.message === "string") {
    const code = codeFromHttpStatus(response.status);
    return {
      code,
      message: body.message,
    };
  }

  return synthesizeFromStatus(response.status);
}

/**
 * Map a numeric Soroban ContractError code (1–17) to a StandardError.
 *
 * Useful after catching errors from `@stellar/stellar-sdk` contract
 * invocations that surface the numeric code.
 *
 * @param contractErrorCode - The numeric ContractError value
 * @param rawMessage - Optional raw message from the contract invocation
 * @returns StandardError with mapped code and message.
 */
export function getContractErrorMessage(
  contractErrorCode: number,
  rawMessage?: string,
): StandardError {
  const code = getContractErrorCode(contractErrorCode);
  const resolved = getError(code);
  return {
    code: resolved.code,
    message: resolved.message,
    details: rawMessage ? { contractMessage: rawMessage } : undefined,
  };
}

/**
 * Look up an error code and return a StandardError.
 *
 * @param errorCode - The error code key (e.g. "AUTH_MISSING_TOKEN")
 * @param details - Optional extra data
 * @returns StandardError
 */
export function getErrorMessage(
  errorCode: string,
  details?: unknown,
): StandardError {
  const resolved = getError(errorCode);
  return {
    code: resolved.code,
    message: resolved.message,
    details,
  };
}

/**
 * Determine whether an error code is retryable.
 */
export function isRetryableError(code: string): boolean {
  return RETRYABLE_ERROR_CODES.has(code);
}

/**
 * Determine whether an error code warrants a "Contact Support" suggestion.
 */
export function isSupportError(code: string): boolean {
  return SUPPORT_ERROR_CODES.has(code);
}

// ─── Private helpers ────────────────────────────────────────────────────────

/**
 * Map an HTTP status code to a closest-matching error code.
 */
function codeFromHttpStatus(status: number): string {
  if (status === 400) return "VAL_MISSING_FIELD";
  if (status === 401) return "AUTH_INVALID_TOKEN";
  if (status === 403) return "AUTH_FORBIDDEN";
  if (status === 404) return "RES_NOT_FOUND";
  if (status === 409) return "RES_CONFLICT";
  if (status === 410) return "RES_GONE";
  if (status === 413) return "VAL_BODY_TOO_LARGE";
  if (status === 415) return "VAL_CONTENT_TYPE";
  if (status === 429) return "RATE_LIMITED_GLOBAL";
  if (status >= 500 && status < 600) return "SRV_INTERNAL";
  return "GEN_UNKNOWN";
}

/**
 * Synthesise a StandardError purely from an HTTP status code.
 */
function synthesizeFromStatus(status: number): StandardError {
  const code = codeFromHttpStatus(status);
  const resolved = getError(code);
  return {
    code: resolved.code,
    message: resolved.message,
  };
}

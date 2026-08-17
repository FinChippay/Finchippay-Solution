/**
 * src/utils/errorResponse.js
 * The single entry point for building and sending API error responses (#270).
 *
 * Every error the API returns is an RFC 7807 `application/problem+json`
 * document (#635):
 *
 *   {
 *     "type": "https://.../docs/error-codes.md#val_invalid_amount",
 *     "title": "Amount must be a positive number.",  // registry message, per code
 *     "status": 400,                                 // the status actually sent
 *     "detail": "Amount must be ...",                // this occurrence
 *     "instance": "/api/payments/send",              // request path, no query
 *     "code": "VAL_INVALID_AMOUNT",                  // from the catalogue
 *     "correlationId": "a1b2c3-...",                 // matches X-Request-ID
 *     "details": { "field": "amount" },              // optional, code-specific
 *     "error": { ... }                               // the pre-7807 body, verbatim
 *   }
 *
 * `error` stays at the top level so existing consumers keep working, and the
 * correlation ID is the same value logged by pino and returned in the
 * `X-Request-ID` response header — that is what makes a user-reported failure
 * traceable across the contract, API, and frontend.
 *
 * Prefer these helpers over calling `formatErrorResponse` directly: they resolve
 * the HTTP status from the catalogue, so a status can never drift from its code.
 *
 * Usage:
 *   const { sendError, createError } = require("../utils/errorResponse");
 *
 *   // Respond immediately.
 *   return sendError(res, "VAL_INVALID_PUBLIC_KEY", { details: { field: "to" } });
 *
 *   // Or hand off to the global error handler.
 *   return next(createError("RES_NOT_FOUND"));
 */

"use strict";

const {
  ERROR_CODES,
  PROBLEM_CONTENT_TYPE,
  getError,
  getErrorLayer,
  httpStatusForCode,
  formatErrorResponse,
  formatProblemResponse,
  getContractErrorCode,
  setCorrelationIdProvider,
} = require("../../../shared/errorCodes");
const { getRequestId } = require("./correlationId");

// Wire the shared registry to this process's correlation ID store, so every
// error body built anywhere in the backend carries the current request's ID —
// including the call sites that still use `formatErrorResponse` directly.
setCorrelationIdProvider(getRequestId);

/**
 * The HTTP status a code maps to. Codes that only ever occur client-side carry
 * `httpStatus: 0`; treat those as 500 if one ever reaches an HTTP response.
 *
 * @param {string} code
 * @returns {number}
 */
function statusForCode(code) {
  return httpStatusForCode(code);
}

/**
 * The `instance` member: the request path with the query string dropped (it can
 * hold secrets) and CR/LF stripped, so a crafted URL cannot forge log lines.
 *
 * @param {import('express').Request} [req]
 * @returns {string | undefined}
 */
function instanceFromRequest(req) {
  const url = req && (req.originalUrl || req.url);
  if (typeof url !== "string") return undefined;
  return url.split("?")[0].replace(/[\r\n]/g, "");
}

/**
 * Build the legacy `{ error }` body without sending it. Prefer
 * `buildProblemResponse`; this stays for consumers of the pre-7807 shape.
 *
 * @param {string} code - Error code key (e.g. "AUTH_FORBIDDEN").
 * @param {{ details?: *, message?: string, correlationId?: string }} [options]
 * @returns {{ error: { code: string, message: string, correlationId?: string, details?: * } }}
 */
function buildErrorResponse(code, options = {}) {
  return formatErrorResponse(code, options.details, {
    message: options.message,
    correlationId: options.correlationId,
  });
}

/**
 * Build the problem+json body without sending it.
 *
 * @param {string} code - Error code key (e.g. "AUTH_FORBIDDEN").
 * @param {{ details?: *, message?: string, correlationId?: string, instance?: string, status?: number }} [options]
 * @returns {object} The RFC 7807 document, `error` member included.
 */
function buildProblemResponse(code, options = {}) {
  return formatProblemResponse(code, options.details, {
    message: options.message,
    correlationId: options.correlationId,
    instance: options.instance,
    status: options.status || statusForCode(code),
  });
}

/**
 * Send a problem+json error response.
 *
 * The status comes from the catalogue unless `options.status` overrides it,
 * which keeps a code and its status from drifting apart across call sites.
 *
 * @param {import('express').Response} res
 * @param {string} code - Error code key.
 * @param {{ details?: *, message?: string, status?: number, instance?: string }} [options]
 * @returns {import('express').Response}
 */
function sendError(res, code, options = {}) {
  const status = options.status || statusForCode(code);
  const instance = options.instance || instanceFromRequest(res.req);
  res.type(PROBLEM_CONTENT_TYPE);
  return res.status(status).json(buildProblemResponse(code, { ...options, status, instance }));
}

/**
 * Send a canonical error response built from a numeric Soroban ContractError.
 *
 * @param {import('express').Response} res
 * @param {number} contractErrorCode - The numeric ContractError value (1–17).
 * @param {{ details?: *, message?: string, status?: number }} [options]
 * @returns {import('express').Response}
 */
function sendContractError(res, contractErrorCode, options = {}) {
  return sendError(res, getContractErrorCode(contractErrorCode), options);
}

/**
 * Create an Error carrying a catalogue code, for handing to `next()`.
 *
 * The global error handler in server.js reads `errorCode`, `status`, and
 * `details` off the error and renders the canonical body from them.
 *
 * @param {string} code - Error code key.
 * @param {{ details?: *, message?: string, status?: number, cause?: Error }} [options]
 * @returns {Error & { errorCode: string, status: number, details?: * }}
 */
function createError(code, options = {}) {
  const entry = getError(code);
  const err = new Error(options.message || entry.message);
  err.errorCode = entry.code;
  err.status = options.status || statusForCode(code);
  if (options.details !== undefined) {
    err.details = options.details;
  }
  if (options.cause) {
    err.cause = options.cause;
  }
  return err;
}

/**
 * Structured fields describing an error, for logging alongside the response.
 * Keeping log fields and response fields derived from the same source is what
 * lets support search logs by the `correlationId` a user quotes.
 *
 * @param {string} code
 * @param {{ details?: * }} [options]
 * @returns {{ errorCode: string, errorLayer: string, status: number, correlationId?: string, details?: * }}
 */
function errorLogFields(code, options = {}) {
  const fields = {
    errorCode: getError(code).code,
    errorLayer: getErrorLayer(code),
    status: statusForCode(code),
  };
  const correlationId = getRequestId();
  if (correlationId) fields.correlationId = correlationId;
  if (options.details !== undefined) fields.details = options.details;
  return fields;
}

module.exports = {
  ERROR_CODES,
  PROBLEM_CONTENT_TYPE,
  buildErrorResponse,
  buildProblemResponse,
  instanceFromRequest,
  sendError,
  sendContractError,
  createError,
  errorLogFields,
  statusForCode,
};

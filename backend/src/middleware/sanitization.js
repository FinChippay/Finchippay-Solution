/**
 * src/middleware/sanitization.js
 * Middleware for parameter sanitization and validation.
 *
 * All user-supplied path and query parameters pass through this layer before
 * reaching controllers. Every function:
 *   - Strips or rejects known-bad characters.
 *   - Returns a structured 400 JSON error with a clear message on failure.
 *   - Passes sanitised values downstream via `req.params` or `req.query`.
 */

"use strict";

const { formatErrorResponse, ERROR_CODES } = require("../../../shared/errorCodes");

/**
 * Sanitize and validate a Stellar public key path parameter.
 *
 * Expected format: 'G' + 55 base-32 (A-Z, 2-7) characters = 56 chars total.
 *
 * Sanitisation steps:
 *   1. Strip any non-alphanumeric characters (e.g. injected slashes, spaces).
 *   2. Reject if the result is not exactly 56 chars starting with 'G'.
 *   3. Reject if the payload contains base-32–invalid characters.
 *
 * Used by: accounts, payments, analytics, tips, webhook routes.
 */
function sanitizePublicKey(req, res, next) {
  const { publicKey } = req.params;

  if (!publicKey) {
    return next();
  }

  // 1. Strip non-alphanumeric characters (defense against path traversal)
  const sanitized = publicKey.replace(/[^a-zA-Z0-9]/g, "");

  // 2. Return 400 if obviously invalid — length or prefix mismatch
  if (sanitized.length !== 56 || !sanitized.startsWith("G")) {
    return res
      .status(ERROR_CODES.VAL_INVALID_PUBLIC_KEY.httpStatus)
      .json(formatErrorResponse("VAL_INVALID_PUBLIC_KEY", {
        reason: "Must be 56 characters starting with 'G'.",
      }));
  }

  // 3. Reject base-32–invalid characters (Stellar keys use A-Z, 2-7 only)
  if (!/^G[A-Z2-7]{55}$/.test(sanitized)) {
    return res
      .status(ERROR_CODES.VAL_INVALID_PUBLIC_KEY.httpStatus)
      .json(formatErrorResponse("VAL_INVALID_PUBLIC_KEY", {
        reason: "Contains characters outside the base-32 alphabet (A-Z, 2-7).",
      }));
  }

  // Update params with sanitized version
  req.params.publicKey = sanitized;
  next();
}

/**
 * Sanitize a Finchippay username path parameter.
 *
 * - Trims leading/trailing whitespace.
 * - Lowercases for case-insensitive lookup.
 * - Strips characters outside [a-z0-9] (3–20 chars).
 * - Returns 400 if the result is empty or too long.
 *
 * Used by: account registration and federation routes.
 */
function sanitizeUsername(req, res, next) {
  const { username } = req.params;

  if (!username) {
    return next();
  }

  const sanitized = username.trim().toLowerCase().replace(/[^a-z0-9]/g, "");

  if (!sanitized || sanitized.length < 3 || sanitized.length > 20) {
    return res
      .status(ERROR_CODES.VAL_INVALID_USERNAME.httpStatus)
      .json(formatErrorResponse("VAL_INVALID_USERNAME"));
  }

  req.params.username = sanitized;
  next();
}

module.exports = { sanitizePublicKey, sanitizeUsername };

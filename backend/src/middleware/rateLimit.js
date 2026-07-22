/**
 * src/middleware/rateLimit.js
 * Dedicated rate limiters for different route sensitivity levels.
 */

"use strict";

const rateLimit = require("express-rate-limit");
const { formatErrorResponse } = require("../../../shared/errorCodes");

/**
 * Strict rate limiting — 20 requests per minute.
 * Applied to Turrets txFunctions routes.
 *
 * standardHeaders: true  → emits RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset.
 * legacyHeaders: false   → suppresses deprecated X-RateLimit-* headers.
 */
const strictLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: formatErrorResponse("RATE_LIMITED_SENSITIVE"),
});

/**
 * Sensitive route limiting — 10 requests per minute (#205).
 * Applied to account lookup and balance endpoints that could be used for
 * account enumeration.
 */
const sensitiveLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: formatErrorResponse("RATE_LIMITED_SENSITIVE"),
});

module.exports = { strictLimiter, sensitiveLimiter };

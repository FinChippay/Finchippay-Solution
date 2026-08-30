"use strict";

const rateLimit = require("express-rate-limit");

// We intentionally do not use `createInstrumentedLimiter` from rateLimit.js
// because we want precise control over the headers so they don't overwrite
// the standard RateLimit-Remaining headers from the IP-based limiter.
const baseLimiter = rateLimit({
  windowMs: process.env.USER_RATE_LIMIT_WINDOW_MS
    ? parseInt(process.env.USER_RATE_LIMIT_WINDOW_MS, 10)
    : 1 * 60 * 1000,
  limit: process.env.USER_RATE_LIMIT_MAX ? parseInt(process.env.USER_RATE_LIMIT_MAX, 10) : 30,
  keyGenerator: (req) => {
    return req.user?.sub || req.ip;
  },
  // Disable standard headers so they don't conflict with IP limiters.
  // We'll inject our own X-RateLimit-User-* headers in the wrapper.
  standardHeaders: false,
  legacyHeaders: false,
  handler: (req, res, _next) => {
    // Return 429 Too Many Requests per requirements
    // "Too many requests from this account"
    res.status(429).json({
      error: {
        code: "RATE_LIMITED_USER",
        message: "Too many requests from this account",
      },
    });
  },
});

/**
 * userLimiter wraps the express-rate-limit to extract req.rateLimit
 * and append X-RateLimit-User-* headers.
 */
function userLimiter(req, res, next) {
  baseLimiter(req, res, (err) => {
    if (err) {
      return next(err);
    }

    // express-rate-limit attaches `req.rateLimit` which contains:
    // limit, current, remaining, resetTime
    if (req.rateLimit) {
      res.setHeader("X-RateLimit-User-Limit", req.rateLimit.limit);
      res.setHeader("X-RateLimit-User-Remaining", req.rateLimit.remaining);
      if (req.rateLimit.resetTime) {
        res.setHeader(
          "X-RateLimit-User-Reset",
          Math.ceil(req.rateLimit.resetTime.getTime() / 1000),
        );
      }
    }

    next();
  });
}

module.exports = { userLimiter };

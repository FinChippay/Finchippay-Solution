/**
 * src/middleware/sanitization.js
 * Middleware for parameter sanitization and validation.
 */

"use strict";

/**
 * Sanitizes and validates a Stellar public key.
 * Expected format: G... (56 chars)
 */
function sanitizePublicKey(req, res, next) {
  const { publicKey } = req.params;

  if (!publicKey) {
    return next();
  }

  // 1. Strip non-alphanumeric characters
  const sanitized = publicKey.replace(/[^a-zA-Z0-9]/g, "");

  // 2. Return 400 if obviously invalid
  // Stellar public keys are exactly 56 chars and start with 'G'
  if (sanitized.length !== 56 || !sanitized.startsWith("G")) {
    return res.status(400).json({
      error: "Invalid Stellar public key format",
    });
  }

  // Update params with sanitized version
  req.params.publicKey = sanitized;
  next();
}

/**
 * Sanitizes a username by trimming and lowercasing.
 */
function sanitizeUsername(req, res, next) {
  const { username } = req.params;

  if (username) {
    req.params.username = username.trim().toLowerCase();
  }

  next();
}

module.exports = { sanitizePublicKey, sanitizeUsername };

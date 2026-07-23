/**
 * src/routes/accounts.js
 * Account lookup and balance endpoints.
 */

"use strict";

const express = require("express");
const router = express.Router();
const { strictLimiter, sensitiveLimiter } = require("../middleware/rateLimit");
const { sanitizePublicKey, sanitizeUsername } = require("../middleware/sanitization");
const { verifyJWT } = require("../middleware/auth");
const accountController = require("../controllers/accountController");

/**
 * Restrict account-data routes to the authenticated account holder (#278).
 * Runs after verifyJWT (which sets req.user.publicKey from the SEP-10 JWT).
 */
function requireOwnAccount(req, res, next) {
  if (req.user?.publicKey !== req.params.publicKey) {
    return res
      .status(403)
      .json({ error: "Forbidden: you may only access your own account data" });
  }
  next();
}

/**
 * The browser `EventSource` API cannot set request headers, so the SSE stream
 * accepts the SEP-10 JWT as a `?token=` query parameter and promotes it to an
 * Authorization header before `verifyJWT` runs (#157). Requests that already
 * carry the header keep using it.
 */
function acceptTokenFromQuery(req, res, next) {
  if (!req.headers.authorization && typeof req.query.token === "string") {
    req.headers.authorization = `Bearer ${req.query.token}`;
  }
  next();
}

/**
 * GET /api/accounts/resolve/:username
 * Resolve a username to a Stellar public key.
 * Must be registered before /:publicKey or Express matches it as a key.
 */
router.get("/resolve/:username", sensitiveLimiter, sanitizeUsername, accountController.resolveUsername);

/**
 * GET /api/accounts/:publicKey
 * Fetch account info and balances from Horizon.
 */
router.get("/:publicKey", sensitiveLimiter, verifyJWT, sanitizePublicKey, requireOwnAccount, accountController.getAccount);

/**
 * GET /api/accounts/:publicKey/balance
 * Fetch just the XLM balance for an account.
 */
router.get("/:publicKey/balance", sensitiveLimiter, verifyJWT, sanitizePublicKey, requireOwnAccount, accountController.getBalance);

/**
 * GET /api/accounts/:publicKey/stream
 * Server-Sent Events stream of XLM balance updates for an account.
 *
 * Long-lived by design, so the sensitive limiter is deliberately omitted — one
 * connection is one request, and it would otherwise be counted against a user
 * who simply left the dashboard open.
 */
router.get(
  "/:publicKey/stream",
  acceptTokenFromQuery,
  verifyJWT,
  sanitizePublicKey,
  requireOwnAccount,
  accountController.streamBalance,
);

/**
 * POST /api/accounts/register
 * Register a new username with a public key.
 */
router.post("/register", strictLimiter, accountController.registerUsername);

module.exports = router;

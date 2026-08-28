/**
 * src/routes/analytics.js
 * Analytics endpoints for transaction volume insights.
 *
 * Pagination note (#74): these endpoints are intentionally NOT cursor-paginated.
 * Each returns a bounded aggregation, not an unbounded list:
 *   - /summary        → a single summary object
 *   - /top-recipients → a fixed top-5 ranking
 *   - /activity       → fixed counts for the 7 days of the week
 * There is nothing to page through, so no `?limit=`/`?cursor=`, `Link`, or
 * `X-Total-Count` is applied here. Genuine list endpoints (tips, payments,
 * webhooks, scheduled, events) carry the standardized pagination contract.
 */

"use strict";

const express = require("express");
const router = express.Router();
const { strictLimiter } = require("../middleware/rateLimit");
const { userLimiter } = require("../middleware/userRateLimit");
const { sanitizePublicKey } = require("../middleware/sanitization");
const { validate } = require("../validation/middleware");
const { publicKeyParamSchema } = require("../validation/schemas");
const analyticsController = require("../controllers/analyticsController");

/**
 * GET /api/analytics/:publicKey/summary
 * Returns: total sent, received, unique counterparties, avg transaction size.
 */
router.get(
  "/:publicKey/summary",
  strictLimiter,
  userLimiter,
  sanitizePublicKey,
  validate(publicKeyParamSchema, "params"),
  analyticsController.getSummary,
);

/**
 * GET /api/analytics/:publicKey/top-recipients
 * Returns: top 5 addresses by total XLM sent, sorted descending.
 */
router.get(
  "/:publicKey/top-recipients",
  strictLimiter,
  userLimiter,
  sanitizePublicKey,
  validate(publicKeyParamSchema, "params"),
  analyticsController.getTopRecipients,
);

/**
 * GET /api/analytics/:publicKey/activity
 * Returns: payment count by day of week (all 7 days).
 */
router.get(
  "/:publicKey/activity",
  strictLimiter,
  userLimiter,
  sanitizePublicKey,
  validate(publicKeyParamSchema, "params"),
  analyticsController.getActivityByDay,
);

module.exports = router;

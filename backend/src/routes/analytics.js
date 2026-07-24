/**
 * src/routes/analytics.js
 * Analytics endpoints for transaction volume insights.
 */

"use strict";

const express = require("express");
const router = express.Router();
const { strictLimiter } = require("../middleware/rateLimit");
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
  sanitizePublicKey,
  validate(publicKeyParamSchema, "params"),
  analyticsController.getActivityByDay,
);

module.exports = router;

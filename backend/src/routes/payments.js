/**
 * src/routes/payments.js
 * Payment history and logging endpoints.
 */

"use strict";

const express = require("express");
const router = express.Router();
const { strictLimiter } = require("../middleware/rateLimit");
const { sanitizePublicKey } = require("../middleware/sanitization");
const { validate } = require("../validation/middleware");
const {
  publicKeyParamSchema,
  paymentsQuerySchema,
} = require("../validation/schemas");
const paymentController = require("../controllers/paymentController");

/**
 * GET /api/payments/:publicKey
 * Fetch payment history for an account via Horizon.
 *
 * Query params:
 *   limit  — number of results (default: 20, max: 100)
 *   cursor — pagination cursor
 */
router.get(
  "/:publicKey",
  strictLimiter,
  sanitizePublicKey,
  validate(publicKeyParamSchema, "params"),
  validate(paymentsQuerySchema, "query"),


  paymentController.getPayments,
);

/**
 * GET /api/payments/:publicKey/stats
 * Return aggregate stats for an account (total sent, received, count).
 */
router.get(
  "/:publicKey/stats",
  strictLimiter,
  validate(publicKeyParamSchema, "params"),
  paymentController.getStats,
);

module.exports = router;

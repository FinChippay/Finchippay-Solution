/**
 * src/routes/tips.js
 * Tip-related API endpoints.
 */

"use strict";

const express = require("express");
const router = express.Router();
const { strictLimiter } = require("../middleware/rateLimit");
const { validate } = require("../validation/middleware");
const { sanitizePublicKey } = require("../middleware/sanitization");
const { pagination } = require("../middleware/pagination");
const {
  tipSchema,
  creatorPublicKeyParamSchema,
  senderPublicKeyParamSchema,
} = require("../validation/schemas");
const tipsController = require("../controllers/tipsController");

/**
 * POST /api/tips
 * Record a new tip.
 */
router.post("/", strictLimiter, validate(tipSchema), tipsController.recordTip);

/**
 * GET /api/tips/received/:creatorPublicKey
 * Get all tips received by a creator.
 */
router.get(
  "/received/:creatorPublicKey",
  strictLimiter,
  sanitizePublicKey,
  validate(creatorPublicKeyParamSchema, "params"),
  pagination,
  tipsController.getTipsReceived,
);

/**
 * GET /api/tips/stats/:creatorPublicKey
 * Get statistics for tips received by a creator.
 */
router.get(
  "/stats/:creatorPublicKey",
  strictLimiter,
  sanitizePublicKey,
  validate(creatorPublicKeyParamSchema, "params"),
  tipsController.getTipsStats,
);

/**
 * GET /api/tips/sent/:senderPublicKey
 * Get all tips sent by a user.
 */
router.get(
  "/sent/:senderPublicKey",
  strictLimiter,
  sanitizePublicKey,
  validate(senderPublicKeyParamSchema, "params"),
  pagination,
  tipsController.getTipsSent,
);

/**
 * GET /api/tips/:creatorPublicKey
 * GET /api/v1/tips/:creatorPublicKey
 * Get all tips received by a creator.
 */
router.get(
  "/:creatorPublicKey",
  strictLimiter,
  sanitizePublicKey,
  validate(creatorPublicKeyParamSchema, "params"),
  pagination,
  tipsController.getTipsReceived,
);

module.exports = router;

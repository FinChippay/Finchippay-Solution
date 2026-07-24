/**
 * src/routes/events.js
 * Contract event query endpoints.
 */

"use strict";

const express = require("express");
const router = express.Router();
const { strictLimiter } = require("../middleware/rateLimit");
const { sanitizePublicKey } = require("../middleware/sanitization");
const eventController = require("../controllers/eventController");

/**
 * GET /api/events/:publicKey
 * Paginated contract events filtered by participant address.
 *
 * Query params:
 *   limit  — number of results (default: 20, max: 100)
 *   offset — 0-based offset for pagination
 */
router.get(
  "/:publicKey",
  strictLimiter,
  sanitizePublicKey,
  eventController.getEvents,
);

/**
 * GET /api/events/:publicKey/stats
 * Aggregate event-type counts for a participant address.
 */
router.get(
  "/:publicKey/stats",
  strictLimiter,
  sanitizePublicKey,
  eventController.getStats,
);

module.exports = router;

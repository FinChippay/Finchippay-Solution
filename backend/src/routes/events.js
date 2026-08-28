/**
 * src/routes/events.js
 * Contract event query endpoints.
 */

"use strict";

const express = require("express");
const router = express.Router();
const { strictLimiter } = require("../middleware/rateLimit");
const { sanitizePublicKey } = require("../middleware/sanitization");
const { validate } = require("../validation/middleware");
const { publicKeyParamSchema, eventsQuerySchema } = require("../validation/schemas");
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
  validate(publicKeyParamSchema, "params"),
  validate(eventsQuerySchema, "query"),
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
  validate(publicKeyParamSchema, "params"),
  eventController.getStats,
);

/**
 * GET /api/events/:publicKey/:eventType
 * Contract events filtered by participant address and event type.
 *
 * Query params:
 *   limit  — number of results (default: 20, max: 100)
 *   offset — 0-based offset for pagination
 *   since  — ISO 8601 timestamp filter (events emitted >= since)
 */
router.get(
  "/:publicKey/:eventType",
  strictLimiter,
  sanitizePublicKey,
  validate(publicKeyParamSchema, "params"),
  eventController.getEventsByType,
);

module.exports = router;

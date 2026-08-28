/**
 * src/routes/webhooks.js
 * Webhook management API endpoints.
 */

"use strict";

const express = require("express");
const router = express.Router();
const webhookService = require("../services/webhookService");
const { formatErrorResponse, ERROR_CODES } = require("../../../shared/errorCodes");
const { validate } = require("../validation/middleware");
const { registerWebhookSchema } = require("../validation/webhookSchemas");
const {
  publicKeyParamSchema,
  idParamSchema,
  getEventsQuerySchema,
  replayEventsBodySchema,
} = require("../validation/schemas");
const {
  paginateInMemory,
  setPaginationHeaders,
  formatPaginatedResponse,
} = require("../utils/paginate");

/**
 * POST /api/webhooks
 * Register a webhook for a Stellar account.
 *
 * Body: { publicKey: "G...", url: "https://...", secret: "whsec_...", topics?: string[] }
 *
 * Validation:
 *   - publicKey must be a valid 56-char Stellar address.
 *   - url must be an HTTPS endpoint (reject http:// in production).
 *   - secret must be at least 8 characters (HMAC-SHA256 signing secret).
 *
 * Secrets are stored encrypted (AES-256-GCM) and a keyed HMAC-SHA256 hash
 * is also persisted for verification. The server restores all webhooks on
 * startup — re-registration is not required after a restart.
 */
router.post("/", validate(registerWebhookSchema), async (req, res) => {
  try {
    const { publicKey, url, secret, topics } = req.validated;
    const webhook = await webhookService.registerWebhook(publicKey, url, secret, topics);
    return res.status(201).json({ success: true, webhook });
  } catch (err) {
    return res
      .status(ERROR_CODES.SRV_INTERNAL.httpStatus)
      .json(formatErrorResponse("SRV_INTERNAL", { reason: err.message }));
  }
});

/**
 * GET /api/webhooks/:publicKey
 * Get all webhooks for a Stellar account with standardized pagination.
 */
router.get("/:publicKey", validate(publicKeyParamSchema, "params"), async (req, res, next) => {
  try {
    const { publicKey } = req.validated;
    const hooks = await webhookService.getWebhooksByPublicKey(publicKey);
    const limit = req.pagination?.limit || Math.min(parseInt(req.query.limit) || 20, 100);
    const cursor = req.pagination?.cursor || null;

    const { data, nextCursor, total } = paginateInMemory(
      hooks || [],
      { limit, cursor },
      (h) => ({ id: h.id }),
      (a, b) => String(b.id || "").localeCompare(String(a.id || "")),
    );

    setPaginationHeaders(req, res, { nextCursor, total, limit });
    const formatted = formatPaginatedResponse(data, nextCursor, total, { limit });
    return res.json({
      ...formatted,
      webhooks: data, // maintain backward compatibility
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/webhooks/:publicKey/events
 * Get paginated past events for a Stellar account.
 */
router.get(
  "/:publicKey/events",
  validate(publicKeyParamSchema, "params"),
  validate(getEventsQuerySchema, "query"),
  async (req, res, next) => {
    try {
      const { publicKey } = req.validatedParams || req.params;
      const options = req.validatedQuery || req.query;
      const limit = req.pagination?.limit || Math.min(parseInt(req.query.limit) || 20, 100);
      const cursor = req.pagination?.cursor || null;

      const rawEvents = await webhookService.getEvents(publicKey, { ...options, limit });
      const { data, nextCursor, total } = paginateInMemory(
        rawEvents || [],
        { limit, cursor },
        (e) => ({ id: e.id || e.timestamp }),
        (a, b) => (b.timestamp || 0) - (a.timestamp || 0),
      );

      setPaginationHeaders(req, res, { nextCursor, total, limit });
      const formatted = formatPaginatedResponse(data, nextCursor, total, { limit });
      return res.json({
        ...formatted,
        events: data, // maintain backward compatibility
      });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * POST /api/webhooks/:publicKey/replay
 * Replay selected events.
 */
router.post(
  "/:publicKey/replay",
  validate(publicKeyParamSchema, "params"),
  validate(replayEventsBodySchema),
  async (req, res, next) => {
    try {
      const { publicKey } = req.validatedParams || req.params;
      const options = req.validated;
      const result = await webhookService.replayEvents(publicKey, options);
      return res.json({ success: true, ...result });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * GET /api/webhooks/:publicKey/events/stats
 * Get event stats by type.
 */
router.get(
  "/:publicKey/events/stats",
  validate(publicKeyParamSchema, "params"),
  async (req, res, next) => {
    try {
      const { publicKey } = req.validatedParams || req.params;
      const stats = await webhookService.getEventStats(publicKey);
      return res.json({ stats });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * GET /api/webhooks/:publicKey/failures
 * Get dead letter queue (failed webhook deliveries) for a Stellar account.
 */
router.get(
  "/:publicKey/failures",
  validate(publicKeyParamSchema, "params"),
  async (req, res, next) => {
    try {
      const { publicKey } = req.validated;
      const failures = await webhookService.getDeadDeliveries(publicKey);
      return res.json({ failures });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * POST /api/webhooks/:publicKey/retry
 * Reset dead deliveries to pending and trigger retry for a Stellar account.
 */
router.post(
  "/:publicKey/retry",
  validate(publicKeyParamSchema, "params"),
  async (req, res, next) => {
    try {
      const { publicKey } = req.validated;
      const result = await webhookService.retryDeadDeliveries(publicKey);
      return res.json({ success: true, ...result });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * GET /api/webhooks/:publicKey/deliveries
 * Paginated delivery history, optionally filtered by status.
 */
router.get(
  "/:publicKey/deliveries",
  validate(publicKeyParamSchema, "params"),
  async (req, res, next) => {
    try {
      const { publicKey } = req.validated;
      const { status, page, limit } = req.query;
      const result = await webhookService.getDeliveries(publicKey, {
        status,
        page: page ? parseInt(page, 10) : 1,
        limit: limit ? parseInt(limit, 10) : 20,
      });
      return res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

/**
 * GET /api/webhooks/:publicKey/deliveries/:id
 * Single delivery detail with retry timeline (attempts, last status, error).
 */
router.get(
  "/:publicKey/deliveries/:id",
  validate(publicKeyParamSchema, "params"),
  async (req, res, next) => {
    try {
      const { publicKey } = req.validated;
      const { id } = req.params;
      const delivery = await webhookService.getDeliveryById(publicKey, id);
      if (!delivery) {
        return res
          .status(ERROR_CODES.RES_NOT_FOUND.httpStatus)
          .json(formatErrorResponse("RES_NOT_FOUND", { resourceType: "delivery", id }));
      }
      return res.json({ delivery });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * DELETE /api/webhooks/:id
 * Delete a webhook by ID.
 */
router.delete("/:id", validate(idParamSchema, "params"), async (req, res, next) => {
  try {
    const { id } = req.validated;
    const deleted = await webhookService.deleteWebhook(id);
    if (!deleted) {
      return res.status(ERROR_CODES.RES_NOT_FOUND.httpStatus).json(
        formatErrorResponse("RES_NOT_FOUND", {
          resourceType: "webhook",
          id,
        }),
      );
    }
    return res.json({ success: true, message: "Webhook " + id + " deleted" });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

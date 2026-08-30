/**
 * src/routes/webhooks.js
 * Webhook management API endpoints.
 *
 * Security (WS1/WS6): every route is authenticated with a SEP-10 JWT
 * (verifyJWT) and scoped to the account inside that token — no route accepts
 * a caller-supplied `publicKey` as the authorization boundary, and cross-user
 * access returns 403. This mirrors the ownership rule push.js applies: an
 * unauthenticated registration API would let anyone subscribe an attacker's
 * endpoint to a victim's payment stream and read that account's events.
 */

"use strict";

const express = require("express");
const router = express.Router();
const webhookService = require("../services/webhookService");
const { formatErrorResponse, ERROR_CODES } = require("../../../shared/errorCodes");
const { verifyJWT } = require("../middleware/auth");
const { sensitiveLimiter, strictLimiter } = require("../middleware/rateLimit");
const { validate } = require("../validation/middleware");
const { registerWebhookSchema } = require("../validation/webhookSchemas");
const {
  publicKeyParamSchema,
  idParamSchema,
  getEventsQuerySchema,
  replayEventsBodySchema,
} = require("../validation/schemas");
const {
  buildPage,
  paginateInMemory,
  setPaginationHeaders,
  formatPaginatedResponse,
} = require("../utils/paginate");

/**
 * Reject a route whose `:publicKey` path param differs from the authenticated
 * account. The authenticated token is the source of truth for authorization,
 * so reading another account's webhooks returns 403.
 */
function requireOwnPublicKey(req, res, next) {
  if (req.user?.publicKey !== req.params.publicKey) {
    return res.status(ERROR_CODES.AUTH_FORBIDDEN.httpStatus).json(
      formatErrorResponse("AUTH_FORBIDDEN", {
        message: "Forbidden: you may only access your own webhooks.",
      }),
    );
  }
  return next();
}

/**
 * Resolve a webhook by ID and require the authenticated account to own it.
 * Used on routes that address a webhook by id without a publicKey param.
 */
async function requireWebhookOwner(req, res, next) {
  try {
    const webhook = await webhookService.getWebhookById(req.params.id);
    if (!webhook) {
      return res.status(ERROR_CODES.RES_NOT_FOUND.httpStatus).json(
        formatErrorResponse("RES_NOT_FOUND", {
          resourceType: "webhook",
          id: req.params.id,
        }),
      );
    }
    if (req.user?.publicKey !== webhook.publicKey) {
      return res.status(ERROR_CODES.AUTH_FORBIDDEN.httpStatus).json(
        formatErrorResponse("AUTH_FORBIDDEN", {
          message: "Forbidden: you may only manage your own webhooks.",
        }),
      );
    }
    req.webhook = webhook;
    return next();
  } catch (err) {
    return next(err);
  }
}

/**
 * POST /api/webhooks
 * Register a webhook for the authenticated account.
 *
 * Body: { url: "https://...", secret: "whsec_...", topics?: string[],
 *         publicKey?: "G..." }
 *
 * The owner comes from the JWT (req.user.publicKey). If a body publicKey is
 * supplied it must match the authenticated account — it is never trusted as
 * the authorization boundary.
 */
router.post(
  "/",
  sensitiveLimiter,
  verifyJWT,
  validate(registerWebhookSchema),
  async (req, res, next) => {
    try {
      const { url, secret, topics } = req.validated;
      const claimed = req.validated.publicKey;
      if (claimed && claimed !== req.user.publicKey) {
        return res.status(ERROR_CODES.AUTH_FORBIDDEN.httpStatus).json(
          formatErrorResponse("AUTH_FORBIDDEN", {
            message: "Forbidden: publicKey in body must match authenticated user.",
          }),
        );
      }
      const webhook = await webhookService.registerWebhook(req.user.publicKey, url, secret, topics);
      return res.status(201).json({ success: true, webhook });
    } catch (err) {
      if (err.status === 400) {
        return res.status(400).json(formatErrorResponse("VAL_INVALID", { reason: err.message }));
      }
      return next(err);
    }
  },
);

/**
 * GET /api/webhooks/:publicKey
 * Get all webhooks for the caller's account with standardized pagination.
 */
router.get(
  "/:publicKey",
  strictLimiter,
  verifyJWT,
  validate(publicKeyParamSchema, "params"),
  requireOwnPublicKey,
  async (req, res, next) => {
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
  },
);

/**
 * GET /api/webhooks/:publicKey/events
 * Get paginated past events for the caller's account.
 */
router.get(
  "/:publicKey/events",
  strictLimiter,
  verifyJWT,
  requireOwnPublicKey,
  validate(publicKeyParamSchema, "params"),
  validate(getEventsQuerySchema, "query"),
  async (req, res, next) => {
    try {
      const { publicKey } = req.validatedParams || req.params;
      const options = req.validatedQuery || req.query;
      const limit = req.pagination?.limit || Math.min(parseInt(req.query.limit) || 20, 100);

      // The service performs composite (created_at, id) keyset pagination and
      // returns limit + 1 rows; buildPage slices the extra row and derives the
      // opaque nextCursor from the last returned row (WS4). No in-memory
      // re-sort is needed — the DB order is the page order.
      const rawEvents = (await webhookService.getEvents(publicKey, { ...options, limit })) || [];
      const { data, nextCursor } = buildPage(rawEvents, limit, (e) => ({
        created_at: e.created_at,
        id: e.id,
      }));

      setPaginationHeaders(req, res, { nextCursor, total: null, limit });
      const formatted = formatPaginatedResponse(data, nextCursor, null, { limit });
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
 * Replay selected events for the caller's account.
 */
router.post(
  "/:publicKey/replay",
  sensitiveLimiter,
  verifyJWT,
  requireOwnPublicKey,
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
 * Get event stats by type for the caller's account.
 */
router.get(
  "/:publicKey/events/stats",
  strictLimiter,
  verifyJWT,
  validate(publicKeyParamSchema, "params"),
  requireOwnPublicKey,
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
 * Get dead letter queue (failed webhook deliveries) for the caller's account.
 */
router.get(
  "/:publicKey/failures",
  strictLimiter,
  verifyJWT,
  validate(publicKeyParamSchema, "params"),
  requireOwnPublicKey,
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
 * Reset dead deliveries to pending and trigger retry for the caller's account.
 */
router.post(
  "/:publicKey/retry",
  sensitiveLimiter,
  verifyJWT,
  validate(publicKeyParamSchema, "params"),
  requireOwnPublicKey,
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
  strictLimiter,
  verifyJWT,
  validate(publicKeyParamSchema, "params"),
  requireOwnPublicKey,
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
 * Single delivery detail with retry timeline.
 */
router.get(
  "/:publicKey/deliveries/:id",
  strictLimiter,
  verifyJWT,
  validate(publicKeyParamSchema, "params"),
  requireOwnPublicKey,
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
 * Delete a webhook by ID, restricted to its owner.
 */
router.delete(
  "/:id",
  sensitiveLimiter,
  verifyJWT,
  requireWebhookOwner,
  validate(idParamSchema, "params"),
  async (req, res, next) => {
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
  },
);

module.exports = router;

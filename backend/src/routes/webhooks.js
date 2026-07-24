"use strict";

const express = require("express");
const router = express.Router();
const webhookService = require("../services/webhookService");
const {
  formatErrorResponse,
  ERROR_CODES,
} = require("../../../shared/errorCodes");
const { validate } = require("../validation/middleware");
const {
  registerWebhookSchema,
  publicKeyParamSchema,
  idParamSchema,
} = require("../validation/schemas");

/**
 * POST /api/webhooks
 * Register a webhook for a Stellar account.
 *
 * Body: { publicKey: "G...", url: "https://...", secret: "whsec_..." }
 *
 * Validation (registerWebhookSchema):
 *   - publicKey must be a valid 56-char Stellar address.
 *   - url must be an HTTPS endpoint (reject http:// in production).
 *   - secret must be at least 8 characters (HMAC-SHA256 signing secret).
 */
router.post("/", validate(registerWebhookSchema), async (req, res, next) => {
  try {
    const { publicKey, url, secret } = req.validated;
    const webhook = await webhookService.registerWebhook(
      publicKey,
      url,
      secret,
    );
    return res.status(201).json({ success: true, webhook });
  } catch (err) {
    return next(err);
  }
});

/**
 * GET /api/webhooks/:publicKey
 * Get all webhooks for a Stellar account.
 */
router.get(
  "/:publicKey",
  validate(publicKeyParamSchema, "params"),
  async (req, res, next) => {
    try {
      const { publicKey } = req.validated;
      const hooks = await webhookService.getWebhooksByPublicKey(publicKey);
      return res.json({ webhooks: hooks });
    } catch (err) {
      return next(err);
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
      return next(err);
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
      return next(err);
    }
  },
);

/**
 * DELETE /api/webhooks/:id
 * Delete a webhook by ID.
 */
router.delete(
  "/:id",
  validate(idParamSchema, "params"),
  async (req, res, next) => {
    try {
      const { id } = req.validated;
      const deleted = await webhookService.deleteWebhook(id);
      if (!deleted) {
        return res
          .status(404)
          .json(formatErrorResponse("RES_NOT_FOUND", { resourceType: "webhook", id }));
      }
      return res.json({ success: true, message: `Webhook ${id} deleted` });
    } catch (err) {
      return next(err);
    }
  },
);

module.exports = router;

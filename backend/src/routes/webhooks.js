"use strict";

const express = require("express");
const router = express.Router();
const {
  registerWebhook,
  getWebhooksByPublicKey,
  deleteWebhook,
#140--Issue-#18-—-Input-Validation-with-Zod-Schemas-FIX
} = require("../services/webhookService");
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

  getDeadDeliveries,
  retryDeadDeliveries,
} = require("../services/webhookService");
const { formatErrorResponse, ERROR_CODES } = require("../../../shared/errorCodes");
master

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
router.post("/", validate(registerWebhookSchema), (req, res) => {
  const { publicKey, url, secret } = req.validated;

  try {
    const webhook = registerWebhook(publicKey, url, secret);
    return res.status(201).json({ success: true, webhook });
  } catch (err) {
    return res
      .status(ERROR_CODES.SRV_INTERNAL.httpStatus)
      .json(formatErrorResponse("SRV_INTERNAL", { reason: err.message }));
  }
});

/**
 * GET /api/webhooks/:publicKey
 * Get all webhooks for a Stellar account.
 */
router.get(
  "/:publicKey",
  validate(publicKeyParamSchema, "params"),
  (req, res) => {
    const { publicKey } = req.validated;
    const hooks = getWebhooksByPublicKey(publicKey);
    return res.json({ webhooks: hooks });
  },
);

/**
 * GET /api/webhooks/:publicKey/failures
 * Get dead letter queue (failed webhook deliveries) for a Stellar account.
 */
router.get("/:publicKey/failures", (req, res) => {
  const { publicKey } = req.params;
  if (!/^G[A-Z0-9]{55}$/.test(publicKey)) {
    return res
      .status(ERROR_CODES.VAL_INVALID_PUBLIC_KEY.httpStatus)
      .json(formatErrorResponse("VAL_INVALID_PUBLIC_KEY"));
  }
  try {
    const failures = getDeadDeliveries(publicKey);
    return res.json({ failures });
  } catch (err) {
    return res
      .status(ERROR_CODES.SRV_INTERNAL.httpStatus)
      .json(formatErrorResponse("SRV_INTERNAL", { reason: err.message }));
  }
});

/**
 * POST /api/webhooks/:publicKey/retry
 * Reset dead deliveries to pending and trigger retry for a Stellar account.
 */
router.post("/:publicKey/retry", (req, res) => {
  const { publicKey } = req.params;
  if (!/^G[A-Z0-9]{55}$/.test(publicKey)) {
    return res
      .status(ERROR_CODES.VAL_INVALID_PUBLIC_KEY.httpStatus)
      .json(formatErrorResponse("VAL_INVALID_PUBLIC_KEY"));
  }
  try {
    const result = retryDeadDeliveries(publicKey);
    return res.json({ success: true, ...result });
  } catch (err) {
    return res
      .status(ERROR_CODES.SRV_INTERNAL.httpStatus)
      .json(formatErrorResponse("SRV_INTERNAL", { reason: err.message }));
  }
});

/**
 * DELETE /api/webhooks/:id
 * Delete a webhook by numeric ID.
 */
router.delete("/:id", validate(idParamSchema, "params"), (req, res) => {
  const { id } = req.validated;
  const deleted = deleteWebhook(id);
  if (!deleted) {
    return res.status(404).json({ error: "Webhook not found" });
  }
  return res.json({ success: true, message: `Webhook ${id} deleted` });
});

module.exports = router;

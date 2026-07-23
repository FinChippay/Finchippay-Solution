"use strict";

const express = require("express");
const router = express.Router();
const {
  registerWebhook,
  getWebhooksByPublicKey,
  deleteWebhook,
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

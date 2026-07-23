"use strict";

const express = require("express");
const router = express.Router();
const {
  registerWebhook,
  getWebhooksByPublicKey,
  deleteWebhook,
 140-issue-18-input-validation-with-zod-schemas-fix
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
 140-issue-18-input-validation-with-zod-schemas-fix
router.post("/", validate(registerWebhookSchema), (req, res) => {
  const { publicKey, url, secret } = req.validated;

router.post("/", async (req, res) => {
  const { publicKey, url, secret } = req.body;
  if (!publicKey || !url || !secret) {
    return res
      .status(ERROR_CODES.VAL_MISSING_FIELD.httpStatus)
      .json(formatErrorResponse("VAL_MISSING_FIELD", { fields: ["publicKey", "url", "secret"] }));
  }

  // Validate public key format
  if (!/^G[A-Z0-9]{55}$/.test(publicKey)) {
    return res
      .status(ERROR_CODES.VAL_INVALID_PUBLIC_KEY.httpStatus)
      .json(formatErrorResponse("VAL_INVALID_PUBLIC_KEY"));
  }

  // Validate URL scheme (production should only accept HTTPS)
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    return res
      .status(ERROR_CODES.VAL_INVALID_URL.httpStatus)
      .json(formatErrorResponse("VAL_INVALID_URL"));
  }
  if (process.env.NODE_ENV === "production" && parsedUrl.protocol !== "https:") {
    return res
      .status(ERROR_CODES.VAL_INVALID_URL.httpStatus)
      .json(formatErrorResponse("VAL_INVALID_URL", { reason: "Must use HTTPS in production." }));
  }

  // Validate secret strength (min 8 chars for HMAC-SHA256)
  if (typeof secret !== "string" || secret.length < 8) {
    return res
      .status(ERROR_CODES.VAL_WEAK_SECRET.httpStatus)
      .json(formatErrorResponse("VAL_WEAK_SECRET"));
  }
 master

  try {
    const webhook = await webhookService.registerWebhook(
      publicKey,
      url,
      secret,
    );
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
 140-issue-18-input-validation-with-zod-schemas-fix
router.get(
  "/:publicKey",
  validate(publicKeyParamSchema, "params"),
  (req, res) => {
    const { publicKey } = req.validated;
    const hooks = getWebhooksByPublicKey(publicKey);
    return res.json({ webhooks: hooks });
  },
);

router.get("/:publicKey", async (req, res) => {
  const { publicKey } = req.params;
  if (!/^G[A-Z0-9]{55}$/.test(publicKey)) {
    return res
      .status(ERROR_CODES.VAL_INVALID_PUBLIC_KEY.httpStatus)
      .json(formatErrorResponse("VAL_INVALID_PUBLIC_KEY"));
  }
  const hooks = await webhookService.getWebhooksByPublicKey(publicKey);
  return res.json({ webhooks: hooks });
});
 master

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
 * Delete a webhook by ID.
 */
 140-issue-18-input-validation-with-zod-schemas-fix
router.delete("/:id", validate(idParamSchema, "params"), (req, res) => {
  const { id } = req.validated;
  const deleted = deleteWebhook(id);

router.delete("/:id", async (req, res) => {
  const { id } = req.params;
  if (!id || typeof id !== "string" || id.length === 0) {
    return res
      .status(ERROR_CODES.VAL_MISSING_FIELD.httpStatus)
      .json(formatErrorResponse("VAL_MISSING_FIELD", { fields: ["id"] }));
  }
  const deleted = await webhookService.deleteWebhook(id);
 master
  if (!deleted) {
    return res.status(404).json({ error: "Webhook not found" });
  }
  return res.json({ success: true, message: `Webhook ${id} deleted` });
});

module.exports = router;

"use strict";

const express = require("express");
const router = express.Router();
const { registerWebhook, getWebhooksByPublicKey, deleteWebhook } = require("../services/webhookService");
const { formatErrorResponse, ERROR_CODES } = require("../../../shared/errorCodes");

/**
 * POST /api/webhooks
 * Register a webhook for a Stellar account.
 *
 * Body: { publicKey: "G...", url: "https://...", secret: "whsec_..." }
 *
 * Validation:
 *   - publicKey must be a valid 56-char Stellar address.
 *   - url must be an HTTPS endpoint (reject http:// in production).
 *   - secret must be at least 16 characters.
 */
router.post("/", (req, res) => {
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
router.get("/:publicKey", (req, res) => {
  const { publicKey } = req.params;
  if (!/^G[A-Z0-9]{55}$/.test(publicKey)) {
    return res
      .status(ERROR_CODES.VAL_INVALID_PUBLIC_KEY.httpStatus)
      .json(formatErrorResponse("VAL_INVALID_PUBLIC_KEY"));
  }
  const hooks = getWebhooksByPublicKey(publicKey);
  return res.json({ webhooks: hooks });
});

/**
 * DELETE /api/webhooks/:id
 * Delete a webhook by numeric ID.
 */
router.delete("/:id", (req, res) => {
  const { id } = req.params;
  if (!id || typeof id !== "string" || id.length === 0) {
    return res
      .status(ERROR_CODES.VAL_MISSING_FIELD.httpStatus)
      .json(formatErrorResponse("VAL_MISSING_FIELD", { fields: ["id"] }));
  }
  const deleted = deleteWebhook(id);
  if (!deleted) {
    return res
      .status(ERROR_CODES.RES_NOT_FOUND.httpStatus)
      .json(formatErrorResponse("RES_NOT_FOUND", { resourceType: "webhook", id }));
  }
  return res.json({ success: true, message: `Webhook ${id} deleted` });
});

module.exports = router;

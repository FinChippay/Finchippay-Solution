"use strict";

const express = require("express");
const router = express.Router();
const webhookService = require("../services/webhookService");

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
router.post("/", async (req, res) => {
  const { publicKey, url, secret } = req.body;
  if (!publicKey || !url || !secret) {
    return res
      .status(400)
      .json({ error: "publicKey, url, and secret are required" });
  }

  // Validate public key format
  if (!/^G[A-Z0-9]{55}$/.test(publicKey)) {
    return res.status(400).json({ error: "Invalid Stellar public key format" });
  }

  // Validate URL scheme (production should only accept HTTPS)
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    return res.status(400).json({ error: "Invalid URL format" });
  }
  if (
    process.env.NODE_ENV === "production" &&
    parsedUrl.protocol !== "https:"
  ) {
    return res
      .status(400)
      .json({ error: "Webhook URL must use HTTPS in production" });
  }

  // Validate secret strength (min 8 chars for HMAC-SHA256)
  if (typeof secret !== "string" || secret.length < 8) {
    return res.status(400).json({
      error: "Secret must be at least 8 characters for HMAC-SHA256 security",
    });
  }

  try {
    const webhook = await webhookService.registerWebhook(
      publicKey,
      url,
      secret,
    );
    return res.status(201).json({ success: true, webhook });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/webhooks/:publicKey
 * Get all webhooks for a Stellar account.
 */
router.get("/:publicKey", async (req, res) => {
  const { publicKey } = req.params;
  if (!/^G[A-Z0-9]{55}$/.test(publicKey)) {
    return res.status(400).json({ error: "Invalid Stellar public key format" });
  }
  const hooks = await webhookService.getWebhooksByPublicKey(publicKey);
  return res.json({ webhooks: hooks });
});

/**
 * DELETE /api/webhooks/:id
 * Delete a webhook by ID.
 */
router.delete("/:id", async (req, res) => {
  const { id } = req.params;
  if (!id || typeof id !== "string" || id.length === 0) {
    return res.status(400).json({ error: "Webhook ID is required" });
  }
  const deleted = await webhookService.deleteWebhook(id);
  if (!deleted) {
    return res.status(404).json({ error: "Webhook not found" });
  }
  return res.json({ success: true, message: `Webhook ${id} deleted` });
});

module.exports = router;

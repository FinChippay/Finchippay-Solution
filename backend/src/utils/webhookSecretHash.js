/**
 * src/utils/webhookSecretHash.js
 *
 * Keyed HMAC-SHA256 fingerprint for webhook secrets — stored alongside the
 * AES-256-GCM ciphertext so a secret can be verified/audited without
 * decryption. Shared by webhookService.js (outbound webhook secrets) and
 * inboundWebhookSecretService.js (inbound webhook secrets).
 *
 * Deliberately dependency-free beyond `crypto`: webhookService.js pulls in
 * @stellar/stellar-sdk for Horizon SSE streaming, which has nothing to do
 * with hashing a secret — importing it just for hashSecret() would drag in
 * that entire (and, in this repo's Jest setup, ESM-transform-troublesome)
 * dependency chain for no reason.
 */

"use strict";

const crypto = require("crypto");
const logger = require("./logger");

/**
 * Server-side secret used to produce the stored HMAC-SHA256 hash.
 * Must be set in the environment; defaults to a generated value that won't
 * survive restarts — force explicit configuration in production.
 */
const WEBHOOK_SECRET_KEY = process.env.WEBHOOK_SECRET_KEY || crypto.randomBytes(32).toString("hex");

if (!process.env.WEBHOOK_SECRET_KEY && process.env.NODE_ENV !== "test") {
  logger.warn(
    "WEBHOOK_SECRET_KEY is not set — a random key will be used. " +
      "Stored secret hashes will not be reproducible across restarts. " +
      "Set WEBHOOK_SECRET_KEY in your environment for production use.",
  );
}

/**
 * Produce a deterministic HMAC-SHA256 hash of `secret` keyed by `id`.
 * This is stored alongside the encrypted secret so the hash can be
 * verified without decryption.
 *
 * @param {string} id
 * @param {string} secret
 * @returns {string} hex digest
 */
function hashSecret(id, secret) {
  return crypto.createHmac("sha256", WEBHOOK_SECRET_KEY).update(`${id}:${secret}`).digest("hex");
}

module.exports = { hashSecret, WEBHOOK_SECRET_KEY };

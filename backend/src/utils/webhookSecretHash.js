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

/**
 * Server-side secret used to produce the stored HMAC-SHA256 hash.
 *
 * Fail-closed by default: in production, an unset WEBHOOK_SECRET_KEY is a
 * fatal misconfiguration (previously it silently rotated a random key every
 * boot, which made every stored secret_hash irreproducible after a restart
 * and broke webhook verification). We throw at module load outside of tests
 * so the operator is forced to configure a stable key. In tests a fixed key
 * keeps behaviour deterministic.
 *
 * Generate a key with:  openssl rand -hex 32
 */
const WEBHOOK_SECRET_KEY = process.env.WEBHOOK_SECRET_KEY
  ? process.env.WEBHOOK_SECRET_KEY
  : process.env.NODE_ENV === "test"
    ? "test-webhook-secret-key-for-unit-tests-only"
    : (() => {
        throw new Error(
          "WEBHOOK_SECRET_KEY is not set. Generate one: openssl rand -hex 32. " +
            "This is fatal so stored webhook secret hashes remain stable across restarts.",
        );
      })();

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

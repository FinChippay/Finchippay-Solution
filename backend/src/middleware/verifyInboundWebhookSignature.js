/**
 * src/middleware/verifyInboundWebhookSignature.js
 *
 * Authenticates INBOUND webhook callbacks (e.g. an anchor/payment processor
 * POSTing transaction status updates to us) using a per-endpoint shared
 * secret. Without this, any unauthenticated third party could forge a
 * "payment completed" callback and trick the system into marking a
 * transaction paid — a direct financial-integrity vulnerability.
 *
 * Required headers:
 *   X-Signature  — hex-encoded HMAC-SHA256 of the raw request body, keyed
 *                  by the endpoint's shared secret.
 *   X-Timestamp  — Unix timestamp in seconds, when the request was signed.
 *
 * Verification, in order:
 *   1. Both headers present.
 *   2. X-Timestamp is a well-formed integer within ±WEBHOOK_REPLAY_WINDOW_SECONDS
 *      of the current time (default 300s / 5 min) — rejects stale requests.
 *   3. X-Signature matches HMAC-SHA256(secret, rawBody) for at least one of
 *      the endpoint's currently-active secrets (crypto.timingSafeEqual —
 *      never `===` on HMACs), checked only after the timestamp is fresh.
 *   4. This exact signature has not been seen before, within a window twice
 *      as long as the replay window — rejects replays of a previously-valid
 *      request. This check runs last (after the signature is confirmed
 *      valid) so an attacker without the secret can't use it to pollute the
 *      nonce store with garbage.
 *
 * Requires `req.rawBody` (a Buffer of the exact bytes received) — see
 * bodyParsing.js's jsonBodyParser(), which must run before this middleware.
 * Re-serializing req.body with JSON.stringify() is NOT used: it isn't
 * guaranteed to reproduce byte-for-byte what the sender actually signed.
 *
 * Multiple endpoints can each have their own secret(s) — call this factory
 * once per endpoint identifier, e.g.:
 *   router.post("/callback", verifyInboundWebhookSignature("sep24_callback"), handler)
 */

"use strict";

const crypto = require("crypto");
const { formatErrorResponse } = require("../../../shared/errorCodes");
const inboundWebhookSecretService = require("../services/inboundWebhookSecretService");
const cacheService = require("../services/cacheService");
const logger = require("../utils/logger");

const REPLAY_WINDOW_SECONDS = parseInt(process.env.WEBHOOK_REPLAY_WINDOW_SECONDS || "300", 10);
const NONCE_TTL_SECONDS = REPLAY_WINDOW_SECONDS * 2;

function reject(res, endpoint, reason) {
  // Deliberately generic on the wire — do not tell the caller *which* check
  // failed (missing vs. stale vs. bad signature vs. replay). The `reason`
  // is only for our own logs.
  logger.warn({ endpoint, reason }, "Inbound webhook signature rejected");
  return res
    .status(401)
    .json(formatErrorResponse("AUTH_INVALID_WEBHOOK_SIGNATURE"));
}

/**
 * @param {string} endpoint  Identifier for the secret to verify against
 *                           (e.g. "sep24_callback"). Passed to
 *                           inboundWebhookSecretService.getActiveSecrets().
 * @returns {import('express').RequestHandler}
 */
function verifyInboundWebhookSignature(endpoint) {
  return async function (req, res, next) {
    const signature = req.headers["x-signature"];
    const timestampHeader = req.headers["x-timestamp"];

    if (!signature || !timestampHeader) {
      return reject(res, endpoint, "missing_headers");
    }

    const timestamp = Number(timestampHeader);
    if (!Number.isFinite(timestamp)) {
      return reject(res, endpoint, "malformed_timestamp");
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    if (Math.abs(nowSeconds - timestamp) > REPLAY_WINDOW_SECONDS) {
      return reject(res, endpoint, "stale_timestamp");
    }

    if (!req.rawBody) {
      // Misconfiguration: jsonBodyParser()'s verify callback didn't run
      // before this middleware. Fail closed, never open, on our own bug.
      logger.error({ endpoint }, "verifyInboundWebhookSignature: req.rawBody is missing");
      return reject(res, endpoint, "missing_raw_body");
    }

    let signatureBuffer;
    try {
      signatureBuffer = Buffer.from(String(signature), "hex");
    } catch {
      return reject(res, endpoint, "malformed_signature");
    }

    let activeSecrets;
    try {
      activeSecrets = await inboundWebhookSecretService.getActiveSecrets(endpoint);
    } catch (err) {
      logger.error({ endpoint, err: err.message }, "Failed to load inbound webhook secrets");
      return reject(res, endpoint, "secret_lookup_failed");
    }

    if (activeSecrets.length === 0) {
      return reject(res, endpoint, "no_active_secret");
    }

    const isValidSignature = activeSecrets.some((secret) => {
      const expected = crypto.createHmac("sha256", secret).update(req.rawBody).digest();
      return (
        expected.length === signatureBuffer.length &&
        crypto.timingSafeEqual(expected, signatureBuffer)
      );
    });

    if (!isValidSignature) {
      return reject(res, endpoint, "signature_mismatch");
    }

    const nonceKey = `webhook:replay:${endpoint}:${signature}`;
    let isFirstUse;
    try {
      isFirstUse = await cacheService.setIfNotExists(nonceKey, NONCE_TTL_SECONDS);
    } catch (err) {
      // Fail closed: if we can't confirm this signature is unused, treat it
      // as a possible replay rather than letting it through.
      logger.error({ endpoint, err: err.message }, "Replay-nonce check failed");
      return reject(res, endpoint, "replay_check_failed");
    }

    if (!isFirstUse) {
      return reject(res, endpoint, "replay_detected");
    }

    next();
  };
}

module.exports = { verifyInboundWebhookSignature, REPLAY_WINDOW_SECONDS };

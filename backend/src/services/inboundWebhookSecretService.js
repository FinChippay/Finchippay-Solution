/**
 * src/services/inboundWebhookSecretService.js
 *
 * Per-endpoint shared secrets for verifying INBOUND webhook callbacks (e.g.
 * anchors/payment processors calling POST /api/sep24/callback) — the
 * counterpart to webhookService.js, which signs and delivers OUTBOUND
 * webhooks.
 *
 * Storage follows the same pattern already used for outbound webhook
 * secrets: AES-256-GCM ciphertext at rest (encryptSecret/decryptSecret),
 * plus a keyed HMAC-SHA256 fingerprint (hashSecret, shared with
 * webhookService.js via utils/webhookSecretHash.js) for defense-in-depth.
 * The raw secret is only ever held in memory — once, at creation/rotation
 * time, so it can be returned to the caller to configure on the
 * counterparty's side. It is never logged.
 *
 * Rotation: multiple rows may be `active` for the same endpoint at once.
 * rotateSecret() inserts a new secret and, when a grace period is given,
 * keeps the old row active with `expires_at` set instead of deactivating it
 * immediately — so an anchor that hasn't yet picked up the new secret keeps
 * working until the grace period elapses.
 */

"use strict";

const crypto = require("crypto");
const knex = require("../db/connection");
const { encryptSecret, decryptSecret } = require("../utils/encryption");
const { hashSecret } = require("../utils/webhookSecretHash");

const TABLE = "inbound_webhook_secrets";

function generateId() {
  return crypto.randomUUID();
}

/** Generate a new random secret (32 bytes, hex-encoded — 64 chars). */
function generateSecretValue() {
  return crypto.randomBytes(32).toString("hex");
}

function rowToMetadata(row) {
  return {
    id: row.id,
    endpoint: row.endpoint,
    active: !!row.active,
    createdAt: row.created_at,
    rotatedAt: row.rotated_at,
    expiresAt: row.expires_at,
  };
}

/**
 * Create the first secret for an endpoint that doesn't have an active one
 * yet. No-op (returns null) if an active secret already exists — safe to
 * call unconditionally at startup.
 *
 * @param {string} endpoint
 * @returns {Promise<{id: string, endpoint: string, secret: string}|null>}
 *   The plaintext secret is returned once, at creation time, only.
 */
async function ensureSecretExists(endpoint) {
  const existing = await knex(TABLE).where({ endpoint, active: true }).first();
  if (existing) return null;
  return createSecret(endpoint);
}

/**
 * Create a new active secret for `endpoint`. Does not deactivate any
 * existing secrets — use rotateSecret() when replacing one.
 *
 * @param {string} endpoint
 * @returns {Promise<{id: string, endpoint: string, secret: string, createdAt: string}>}
 */
async function createSecret(endpoint) {
  const id = generateId();
  const secret = generateSecretValue();
  const createdAt = new Date().toISOString();

  await knex(TABLE).insert({
    id,
    endpoint,
    secret_encrypted: encryptSecret(secret),
    secret_hash: hashSecret(endpoint, secret),
    active: true,
    created_at: createdAt,
  });

  return { id, endpoint, secret, createdAt };
}

/**
 * Rotate the secret for `endpoint`: create a new active secret, and either
 * immediately deactivate the previously-active secret(s) (graceSeconds=0,
 * the default) or give them a bounded grace window during which both the
 * old and new secret verify successfully.
 *
 * @param {string} endpoint
 * @param {{graceSeconds?: number}} [options]
 * @returns {Promise<{id: string, endpoint: string, secret: string, createdAt: string}>}
 */
async function rotateSecret(endpoint, { graceSeconds = 0 } = {}) {
  const now = new Date();
  const previouslyActive = await knex(TABLE).where({ endpoint, active: true });

  const created = await createSecret(endpoint);

  if (previouslyActive.length > 0) {
    const ids = previouslyActive.map((row) => row.id);
    if (graceSeconds > 0) {
      const expiresAt = new Date(now.getTime() + graceSeconds * 1000).toISOString();
      await knex(TABLE)
        .whereIn("id", ids)
        .update({ rotated_at: now.toISOString(), expires_at: expiresAt });
    } else {
      await knex(TABLE)
        .whereIn("id", ids)
        .update({ active: false, rotated_at: now.toISOString() });
    }
  }

  return created;
}

/**
 * Immediately revoke a specific secret (e.g. suspected leak), regardless of
 * any grace period a rotation may have granted it.
 *
 * @param {string} endpoint
 * @param {string} id
 * @returns {Promise<boolean>} true if a row was revoked
 */
async function revokeSecret(endpoint, id) {
  const count = await knex(TABLE)
    .where({ endpoint, id })
    .update({ active: false, expires_at: new Date().toISOString() });
  return count > 0;
}

/**
 * Return every currently-valid (active and, if `expires_at` is set, not yet
 * expired) plaintext secret for `endpoint`, decrypted. Used internally by
 * verifyInboundWebhookSignature.js — never returned over HTTP.
 *
 * @param {string} endpoint
 * @returns {Promise<string[]>}
 */
async function getActiveSecrets(endpoint) {
  const nowIso = new Date().toISOString();
  const rows = await knex(TABLE)
    .where({ endpoint, active: true })
    .where((builder) => builder.whereNull("expires_at").orWhere("expires_at", ">", nowIso));

  return rows.map((row) => decryptSecret(row.secret_encrypted));
}

/**
 * List secret metadata (no plaintext, no ciphertext) for an endpoint —
 * for operational visibility (e.g. "which secrets are currently active").
 *
 * @param {string} endpoint
 * @returns {Promise<object[]>}
 */
async function listSecrets(endpoint) {
  const rows = await knex(TABLE).where({ endpoint }).orderBy("created_at", "desc");
  return rows.map(rowToMetadata);
}

module.exports = {
  ensureSecretExists,
  createSecret,
  rotateSecret,
  revokeSecret,
  getActiveSecrets,
  listSecrets,
};

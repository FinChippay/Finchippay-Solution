/**
 * src/services/emailVerificationService.js
 *
 * Email address verification flow:
 *
 * 1. POST /api/emails/:publicKey/verify  → generate token, send verification email
 * 2. POST /api/emails/:publicKey/confirm → verify token, mark email as confirmed
 *
 * Verified emails are persisted in email_verification_tokens and marked on
 * the notification_email_preferences row via email_verified flag.
 *
 * Verified email is required before email notifications are delivered.
 */

"use strict";

const crypto = require("crypto");
const knex = require("../db/connection");
const logger = require("../utils/logger");
const emailRenderer = require("./emailRenderer");

const BASE_URL = process.env.APP_BASE_URL || "https://finchippay.io";
const TOKEN_TTL_HOURS = 24;

// ─── Internal helpers ─────────────────────────────────────────────────────────

function generateToken() {
  return crypto.randomBytes(32).toString("hex");
}

function expiresAt() {
  const d = new Date();
  d.setHours(d.getHours() + TOKEN_TTL_HOURS);
  return d.toISOString();
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Initiate email verification for a public key.
 * Generates a secure token, stores it, and returns the rendered email payload.
 *
 * Callers are expected to actually send the email via notificationService or
 * the email queue.
 *
 * @param {string} publicKey
 * @param {string} email
 * @returns {Promise<{ token: string, rendered: { html, text, subject } }>}
 */
async function initiateVerification(publicKey, email) {
  const token = generateToken();
  const exp = expiresAt();
  const verificationUrl = `${BASE_URL}/api/emails/${encodeURIComponent(publicKey)}/confirm?token=${token}`;

  // Invalidate any previous tokens for this public key
  await knex("email_verification_tokens")
    .where({ public_key: publicKey })
    .where("verified", false)
    .delete();

  await knex("email_verification_tokens").insert({
    public_key: publicKey,
    email,
    token,
    verified: false,
    expires_at: exp,
    created_at: new Date().toISOString(),
  });

  logger.info(
    { type: "email_verification_initiated", publicKey, email },
    "Email verification initiated",
  );

  const rendered = emailRenderer.render("email_verification", { verificationUrl });
  return { token, rendered };
}

/**
 * Confirm a verification token.
 *
 * @param {string} publicKey
 * @param {string} token
 * @returns {Promise<{ success: boolean, email?: string, error?: string }>}
 */
async function confirmVerification(publicKey, token) {
  const row = await knex("email_verification_tokens")
    .where({ public_key: publicKey, token })
    .first();

  if (!row) {
    return { success: false, error: "Invalid or unknown token" };
  }

  if (row.verified) {
    return { success: true, email: row.email, alreadyVerified: true };
  }

  if (new Date(row.expires_at) < new Date()) {
    return { success: false, error: "Token has expired" };
  }

  // Mark token as verified
  await knex("email_verification_tokens").where({ id: row.id }).update({
    verified: true,
    verified_at: new Date().toISOString(),
  });

  // Persist verified email in notification_email_preferences (upsert)
  const existing = await knex("notification_email_preferences")
    .where("public_key", publicKey)
    .first();

  if (existing) {
    await knex("notification_email_preferences").where("public_key", publicKey).update({
      email: row.email,
      email_verified: true,
      updated_at: new Date().toISOString(),
    });
  } else {
    await knex("notification_email_preferences").insert({
      public_key: publicKey,
      email: row.email,
      email_verified: true,
      events: JSON.stringify(["payment_received", "escrow_released", "stream_claimed"]),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  }

  logger.info(
    { type: "email_verification_confirmed", publicKey, email: row.email },
    "Email verified",
  );

  return { success: true, email: row.email };
}

/**
 * Check whether a public key has a verified email.
 *
 * @param {string} publicKey
 * @returns {Promise<{ verified: boolean, email?: string }>}
 */
async function isEmailVerified(publicKey) {
  const pref = await knex("notification_email_preferences")
    .where({ public_key: publicKey })
    .first();

  if (!pref || !pref.email_verified) {
    return { verified: false };
  }
  return { verified: true, email: pref.email };
}

module.exports = {
  initiateVerification,
  confirmVerification,
  isEmailVerified,
};

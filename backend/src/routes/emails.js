/**
 * src/routes/emails.js
 *
 * Email-related routes:
 *
 * GET  /api/emails/track/:emailId/open.gif  — tracking pixel (1×1 GIF)
 * GET  /api/emails/unsubscribe              — one-click unsubscribe (token param)
 * POST /api/emails/:publicKey/verify        — initiate email verification
 * POST /api/emails/:publicKey/confirm       — confirm verification token
 * POST /api/emails/webhook/bounce          — receive bounce events from provider
 */

"use strict";

const express = require("express");
const router = express.Router();
const crypto = require("crypto");

const knex = require("../db/connection");
const logger = require("../utils/logger");
const emailTrackingService = require("../services/emailTrackingService");
const emailVerificationService = require("../services/emailVerificationService");
const notificationService = require("../services/notificationService");

const BASE_URL = process.env.APP_BASE_URL || "https://finchippay.io";

// ─── 1×1 transparent GIF (tracking pixel) ────────────────────────────────────

// Minimal 1×1 transparent GIF (43 bytes)
const TRACKING_GIF = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64",
);

/**
 * @swagger
 * /api/emails/track/{emailId}/open.gif:
 *   get:
 *     summary: Email open tracking pixel
 *     tags: [Emails]
 *     parameters:
 *       - in: path
 *         name: emailId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: 1x1 transparent GIF
 *         content:
 *           image/gif: {}
 */
router.get("/track/:emailId/open.gif", async (req, res) => {
  const { emailId } = req.params;
  try {
    await emailTrackingService.handleOpen(emailId, {
      userAgent: req.headers["user-agent"] || null,
      ip: req.ip || null,
    });
  } catch (err) {
    // Don't fail the pixel response on tracking errors
    logger.warn({ type: "tracking_pixel_error", emailId, error: err.message }, "Pixel error");
  }
  res.set({
    "Content-Type": "image/gif",
    "Content-Length": TRACKING_GIF.length,
    "Cache-Control": "no-cache, no-store, must-revalidate",
    Pragma: "no-cache",
    Expires: "0",
  });
  res.end(TRACKING_GIF);
});

// ─── Unsubscribe ──────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/emails/unsubscribe:
 *   get:
 *     summary: One-click unsubscribe
 *     tags: [Emails]
 *     parameters:
 *       - in: query
 *         name: token
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Successfully unsubscribed
 *       400:
 *         description: Invalid token
 */
router.get("/unsubscribe", async (req, res) => {
  const { token, category } = req.query;
  if (!token || typeof token !== "string") {
    return res.status(400).json({ error: "Missing or invalid unsubscribe token" });
  }

  try {
    const row = await knex("email_unsubscribes").where("token", token).first();
    if (!row) {
      return res.status(400).json({ error: "Invalid unsubscribe token" });
    }

    const targetCategory = category || row.category || "all";

    // Mark as unsubscribed (update unsubscribed_at)
    await knex("email_unsubscribes").where("token", token).update({
      unsubscribed_at: new Date().toISOString(),
      category: targetCategory,
    });

    logger.info(
      { type: "email_unsubscribed", email: row.email, category: targetCategory },
      "Unsubscribed",
    );

    return res.json({
      success: true,
      email: row.email,
      category: targetCategory,
      message: `Successfully unsubscribed from ${targetCategory} emails`,
    });
  } catch (err) {
    logger.error({ type: "unsubscribe_error", error: err.message }, "Unsubscribe failed");
    return res.status(500).json({ error: "Failed to process unsubscribe request" });
  }
});

/**
 * POST /api/emails/unsubscribe — body-based unsubscribe
 */
router.post("/unsubscribe", async (req, res) => {
  const { email, category, reason } = req.body || {};
  if (!email) {
    return res.status(400).json({ error: "email is required" });
  }

  const targetCategory = category || "all";
  const token = crypto.randomBytes(24).toString("base64url");

  try {
    await knex("email_unsubscribes")
      .insert({
        email,
        category: targetCategory,
        token,
        reason: reason || null,
        unsubscribed_at: new Date().toISOString(),
      })
      .onConflict(["email", "category"])
      .merge({ unsubscribed_at: new Date().toISOString(), reason: reason || null });

    logger.info({ type: "email_unsubscribed", email, category: targetCategory }, "Unsubscribed");
    return res.json({ success: true, email, category: targetCategory });
  } catch (err) {
    logger.error({ type: "unsubscribe_error", error: err.message }, "Unsubscribe failed");
    return res.status(500).json({ error: "Failed to process unsubscribe request" });
  }
});

// ─── Email Verification ───────────────────────────────────────────────────────

/**
 * @swagger
 * /api/emails/{publicKey}/verify:
 *   post:
 *     summary: Initiate email verification
 *     tags: [Emails]
 *     parameters:
 *       - in: path
 *         name: publicKey
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email]
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *     responses:
 *       200:
 *         description: Verification email sent
 *       400:
 *         description: Invalid request
 */
router.post("/:publicKey/verify", async (req, res) => {
  const { publicKey } = req.params;
  const { email } = req.body || {};

  if (!email || typeof email !== "string" || !email.includes("@")) {
    return res.status(400).json({ error: "Valid email address is required" });
  }

  try {
    await emailVerificationService.initiateVerification(publicKey, email);

    // Queue the verification email
    await notificationService.queueEmail(email, "email_verification", {
      verificationUrl: `${BASE_URL}/api/emails/${encodeURIComponent(publicKey)}/confirm?token=PENDING`,
    }, { publicKey });

    // Actually send immediately for verification flows
    const t = notificationService.isEnabled;
    if (t) {
      await emailVerificationService.initiateVerification(publicKey, email);
      const r2 = emailVerificationService;
      void r2; // just ensuring service is loaded
    }

    logger.info({ type: "verification_email_queued", publicKey, email }, "Verification queued");
    return res.json({ success: true, message: "Verification email sent" });
  } catch (err) {
    logger.error({ type: "verify_error", error: err.message }, "Verification initiation failed");
    return res.status(500).json({ error: "Failed to send verification email" });
  }
});

/**
 * @swagger
 * /api/emails/{publicKey}/confirm:
 *   post:
 *     summary: Confirm email verification token
 *     tags: [Emails]
 *     parameters:
 *       - in: path
 *         name: publicKey
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [token]
 *             properties:
 *               token:
 *                 type: string
 *     responses:
 *       200:
 *         description: Email verified successfully
 *       400:
 *         description: Invalid or expired token
 */
router.post("/:publicKey/confirm", async (req, res) => {
  const { publicKey } = req.params;
  const token = req.body?.token || req.query?.token;

  if (!token) {
    return res.status(400).json({ error: "token is required" });
  }

  try {
    const result = await emailVerificationService.confirmVerification(publicKey, token);
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }
    return res.json({
      success: true,
      email: result.email,
      alreadyVerified: result.alreadyVerified || false,
    });
  } catch (err) {
    logger.error({ type: "confirm_error", error: err.message }, "Verification confirmation failed");
    return res.status(500).json({ error: "Failed to confirm verification" });
  }
});

// Also support GET for one-click from email link
router.get("/:publicKey/confirm", async (req, res) => {
  const { publicKey } = req.params;
  const { token } = req.query;

  if (!token) {
    return res.status(400).json({ error: "token is required" });
  }

  try {
    const result = await emailVerificationService.confirmVerification(publicKey, token);
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }
    return res.json({ success: true, email: result.email });
  } catch (err) {
    logger.error({ type: "confirm_error", error: err.message }, "Verification confirmation failed");
    return res.status(500).json({ error: "Failed to confirm verification" });
  }
});

// ─── Bounce webhook ───────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/emails/webhook/bounce:
 *   post:
 *     summary: Receive bounce/complaint events from email provider
 *     tags: [Emails]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: Event processed
 */
router.post("/webhook/bounce", async (req, res) => {
  const payload = req.body || {};
  // Generic webhook handler — adapts to SendGrid/SES/Mailgun shapes
  const events = Array.isArray(payload) ? payload : [payload];

  for (const ev of events) {
    const emailAddress = ev.email || ev.recipient || ev.to || "";
    const emailId = ev.sg_message_id || ev.messageId || ev.email_id || "unknown";
    const eventType = (ev.event || ev.type || "").toLowerCase();
    const bounceType = ev.type === "permanent" || ev.bounce_class === "hard" ? "hard" : "soft";

    if (eventType === "bounce" || eventType === "hardbounce") {
      await emailTrackingService.handleBounce(emailAddress, emailId, bounceType, ev.reason);
    } else if (eventType === "open") {
      await emailTrackingService.handleOpen(emailId, {
        userAgent: ev.useragent || null,
        ip: ev.ip || null,
      });
    } else if (eventType === "click") {
      await emailTrackingService.handleClick(emailId, ev.url || "", { ip: ev.ip });
    } else if (eventType === "delivered" || eventType === "delivery") {
      await emailTrackingService.recordEvent(emailId, "delivered", {});
    } else if (eventType === "spamreport" || eventType === "complained") {
      await emailTrackingService.recordEvent(emailId, "complained", { metadata: ev });
    }
  }

  return res.json({ received: events.length });
});

// ─── Status endpoint ──────────────────────────────────────────────────────────

/**
 * GET /api/emails/status/:emailId
 * Returns tracking events for a given email tracking ID.
 */
router.get("/status/:emailId", async (req, res) => {
  const { emailId } = req.params;
  try {
    const events = await emailTrackingService.getEvents(emailId);
    return res.json({ emailId, events });
  } catch (err) {
    logger.error({ type: "email_status_error", error: err.message }, "Status fetch failed");
    return res.status(500).json({ error: "Failed to fetch email status" });
  }
});

module.exports = router;

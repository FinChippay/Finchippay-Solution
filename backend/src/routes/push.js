/**
 * src/routes/push.js
 * Push notification subscription management endpoints.
 *
 * POST /api/push/subscribe   - Register a push subscription
 * POST /api/push/unsubscribe - Remove a push subscription
 * GET  /api/push/vapid-public-key - Return the VAPID public key for browsers
 */

"use strict";

const express = require("express");
const router = express.Router();
const { z } = require("zod");
const { strictLimiter } = require("../middleware/rateLimit");
const { validate } = require("../validation/middleware");
const { addSubscription, removeSubscription } = require("../services/pushService");

// ─── Validation schemas ───────────────────────────────────────────────────────

const subscribeSchema = z.object({
  publicKey: z
    .string()
    .regex(/^G[A-Z0-9]{55}$/, "Invalid Stellar public key format"),
  subscription: z.object({
    endpoint: z.string().url("Invalid push endpoint URL"),
    keys: z
      .object({
        p256dh: z.string(),
        auth: z.string(),
      })
      .optional(),
  }),
});

const unsubscribeSchema = z.object({
  publicKey: z
    .string()
    .regex(/^G[A-Z0-9]{55}$/, "Invalid Stellar public key format"),
  endpoint: z.string().url("Invalid push endpoint URL"),
});

// ─── Routes ───────────────────────────────────────────────────────────────────

/**
 * GET /api/push/vapid-public-key
 * Return the server's VAPID public key so browsers can subscribe.
 * This endpoint is intentionally public (no auth required).
 */
router.get("/vapid-public-key", (req, res) => {
  const key = process.env.VAPID_PUBLIC_KEY;
  if (!key) {
    return res
      .status(503)
      .json({ error: "Push notifications are not configured on this server." });
  }
  return res.json({ vapidPublicKey: key });
});

/**
 * POST /api/push/subscribe
 * Store a new push subscription for a Stellar account.
 *
 * Body: { publicKey: string, subscription: PushSubscriptionJSON }
 */
router.post(
  "/subscribe",
  strictLimiter,
  validate(subscribeSchema),
  async (req, res, next) => {
    try {
      const { publicKey, subscription } = req.validated;
      await addSubscription(publicKey, subscription);
      return res
        .status(201)
        .json({ success: true, message: "Subscription registered." });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/push/unsubscribe
 * Remove a push subscription for a Stellar account.
 *
 * Body: { publicKey: string, endpoint: string }
 */
router.post(
  "/unsubscribe",
  strictLimiter,
  validate(unsubscribeSchema),
  async (req, res, next) => {
    try {
      const { publicKey, endpoint } = req.validated;
      await removeSubscription(publicKey, endpoint);
      return res
        .status(200)
        .json({ success: true, message: "Subscription removed." });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;

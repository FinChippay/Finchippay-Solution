/**
 * src/routes/push.js
 * Web Push subscription management.
 *
 * Subscribe/unsubscribe require a SEP-10 JWT and act on the account inside
 * that token. Deriving the owner from the token rather than the request body
 * is deliberate: a push subscription is a delivery channel for an account's
 * payment activity, so an unauthenticated endpoint would let anyone register
 * their own device against someone else's account and learn when that account
 * receives money. This mirrors the ownership rule accounts.js applies (#278).
 *
 * GET /public-key is unauthenticated: the VAPID public key is public by
 * definition — the browser needs it before any login to call
 * pushManager.subscribe().
 */

"use strict";

const express = require("express");
const router = express.Router();

const { strictLimiter } = require("../middleware/rateLimit");
const { verifyJWT } = require("../middleware/auth");
const { validate } = require("../validation/middleware");
const { pushSubscribeSchema, pushUnsubscribeSchema } = require("../validation/schemas");
const { sendError } = require("../utils/errorResponse");
const pushService = require("../services/pushService");
const logger = require("../utils/logger");

/**
 * Reject a body whose `publicKey` disagrees with the authenticated account.
 *
 * The body field is optional, so this only fires when a client sends one —
 * turning a client-side account mix-up into a clear 403 instead of silently
 * subscribing the wrong account.
 */
function requireOwnAccount(req, res, next) {
  const claimed = req.validated?.publicKey;
  if (claimed && claimed !== req.user?.publicKey) {
    return sendError(res, "AUTH_FORBIDDEN", {
      message: "Forbidden: you may only manage your own push subscriptions.",
    });
  }
  next();
}

/**
 * GET /api/push/public-key
 * The VAPID public key for PushManager.subscribe(), plus whether the server
 * can actually send. `enabled: false` lets the UI skip the prompt entirely
 * rather than asking for permission it cannot use.
 */
router.get("/public-key", strictLimiter, (req, res) => {
  return res.json({
    success: true,
    data: {
      publicKey: pushService.getPublicKey(),
      enabled: pushService.isPushEnabled(),
    },
  });
});

/**
 * POST /api/push/subscribe
 * Register (or refresh) this browser's subscription for the caller's account.
 */
router.post(
  "/subscribe",
  strictLimiter,
  verifyJWT,
  validate(pushSubscribeSchema),
  requireOwnAccount,
  async (req, res, next) => {
    try {
      const publicKey = req.user.publicKey;
      const { subscription } = req.validated;

      const { created } = await pushService.addSubscription(publicKey, subscription);

      return res.status(created ? 201 : 200).json({
        success: true,
        data: { created },
        message: created ? "Push subscription registered" : "Push subscription updated",
      });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * POST /api/push/unsubscribe
 * Remove one device's subscription. Idempotent: unsubscribing an endpoint that
 * is already gone still succeeds, so a client retrying after a dropped
 * response does not see an error.
 */
router.post(
  "/unsubscribe",
  strictLimiter,
  verifyJWT,
  validate(pushUnsubscribeSchema),
  requireOwnAccount,
  async (req, res, next) => {
    try {
      const publicKey = req.user.publicKey;
      const { endpoint } = req.validated;

      const { removed } = await pushService.removeSubscription(publicKey, endpoint);

      return res.json({
        success: true,
        data: { removed },
        message: removed > 0 ? "Push subscription removed" : "No matching push subscription",
      });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * GET /api/push/subscriptions
 * The caller's registered devices. Endpoints are returned truncated: the full
 * value is a bearer-like capability for that device, and the UI only needs
 * enough to tell devices apart.
 */
router.get("/subscriptions", strictLimiter, verifyJWT, async (req, res, next) => {
  try {
    const rows = await pushService.listSubscriptions(req.user.publicKey);

    return res.json({
      success: true,
      data: rows.map((row) => ({
        id: row.id,
        endpointPreview: `${String(row.endpoint).slice(0, 40)}…`,
        createdAt: row.created_at,
        lastUsedAt: row.last_used_at,
      })),
    });
  } catch (err) {
    logger.debug({ err }, "Failed to list push subscriptions");
    next(err);
  }
});

module.exports = router;

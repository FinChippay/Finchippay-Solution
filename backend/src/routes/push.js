/**
 * src/routes/push.js
 * Routes for managing web push subscriptions.
 */

"use strict";

const express = require("express");
const router = express.Router();
const pushService = require("../services/pushService");
const webhookService = require("../services/webhookService");
const { formatErrorResponse, ERROR_CODES } = require("../../../shared/errorCodes");

/**
 * POST /api/push/subscribe
 * Subscribes a user to push notifications.
 * Body: { publicKey: string, subscription: object }
 */
router.post("/subscribe", async (req, res, next) => {
  try {
    const { publicKey, subscription } = req.body;

    if (!publicKey || !subscription) {
      return res
        .status(ERROR_CODES.VAL_MISSING_FIELD.httpStatus)
        .json(formatErrorResponse("VAL_MISSING_FIELD", { fields: ["publicKey", "subscription"] }));
    }

    await pushService.saveSubscription(publicKey, subscription);
    webhookService.startMonitoring(publicKey);
    res.status(201).json({ message: "Subscription saved successfully." });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /api/push/unsubscribe
 * Unsubscribes a user from push notifications.
 * Body: { publicKey: string, endpoint: string }
 */
router.delete("/unsubscribe", async (req, res, next) => {
  try {
    const { publicKey, endpoint } = req.body;

    if (!publicKey || !endpoint) {
      return res
        .status(ERROR_CODES.VAL_MISSING_FIELD.httpStatus)
        .json(formatErrorResponse("VAL_MISSING_FIELD", { fields: ["publicKey", "endpoint"] }));
    }

    await pushService.removeSubscription(publicKey, endpoint);
    res.json({ message: "Subscription removed successfully." });
  } catch (error) {
    next(error);
  }
});

module.exports = router;

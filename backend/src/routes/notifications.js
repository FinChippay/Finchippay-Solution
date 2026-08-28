/**
 * src/routes/notifications.js
 * Notification preference management and history API endpoints.
 */

"use strict";

const express = require("express");
const rateLimit = require("express-rate-limit");
const router = express.Router();
const knex = require("../db/connection");
const notificationService = require("../services/notificationService");
const { formatErrorResponse, ERROR_CODES } = require("../../../shared/errorCodes");
const { validate } = require("../validation/middleware");
const {
  registerEmailSchema,
  updateEmailSchema,
  publicKeyParamSchema,
} = require("../validation/schemas");
const logger = require("../utils/logger");

const notificationLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: formatErrorResponse("RATE_LIMITED_SENSITIVE"),
});

// ─── Existing email endpoints ────────────────────────────────────────────────

/**
 * POST /api/notifications/email
 * Register an email for notification preferences for a Stellar account.
 *
 * Body: { publicKey: "G...", email: "user@example.com", events?: string[] }
 */
router.post("/email", notificationLimiter, validate(registerEmailSchema), async (req, res, next) => {
  try {
    const { publicKey, email, events } = req.validated;
    const preference = await notificationService.registerEmail(publicKey, email, { events });
    return res.status(201).json({ success: true, preference });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/notifications/email/:publicKey
 * Update email notification preferences for a Stellar account.
 *
 * Body: { email?: string, events?: string[] }
 */
router.put(
  "/email/:publicKey",
  notificationLimiter,
  validate(publicKeyParamSchema, "params"),
  validate(updateEmailSchema),
  async (req, res, next) => {
    try {
      const { publicKey } = req.validated;
      const { email, events } = req.validated;

      // Fetch existing preference
      const existing = await notificationService.getEmailPreference(publicKey);
      if (!existing) {
        return res.status(ERROR_CODES.RES_NOT_FOUND.httpStatus).json(
          formatErrorResponse("RES_NOT_FOUND", {
            resourceType: "notification_preference",
            publicKey,
          }),
        );
      }

      const preference = await notificationService.registerEmail(
        publicKey,
        email || existing.email,
        { events: events || existing.events },
      );
      return res.json({ success: true, preference });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * GET /api/notifications/email/:publicKey
 * Get email notification preferences for a Stellar account.
 */
router.get(
  "/email/:publicKey",
  notificationLimiter,
  validate(publicKeyParamSchema, "params"),
  async (req, res, next) => {
    try {
      const { publicKey } = req.validated;
      const preference = await notificationService.getEmailPreference(publicKey);
      if (!preference) {
        return res.status(ERROR_CODES.RES_NOT_FOUND.httpStatus).json(
          formatErrorResponse("RES_NOT_FOUND", {
            resourceType: "notification_preference",
            publicKey,
          }),
        );
      }
      return res.json({ success: true, preference });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * DELETE /api/notifications/email/:publicKey
 * Delete email notification preferences for a Stellar account.
 */
router.delete(
  "/email/:publicKey",
  notificationLimiter,
  validate(publicKeyParamSchema, "params"),
  async (req, res, next) => {
    try {
      const { publicKey } = req.validated;
      const deleted = await notificationService.deleteEmailPreference(publicKey);
      if (!deleted) {
        return res.status(ERROR_CODES.RES_NOT_FOUND.httpStatus).json(
          formatErrorResponse("RES_NOT_FOUND", {
            resourceType: "notification_preference",
            publicKey,
          }),
        );
      }
      return res.json({
        success: true,
        message: `Notification preference for ${publicKey} deleted`,
      });
    } catch (err) {
      next(err);
    }
  },
);

// ─── Unified preferences endpoints ───────────────────────────────────────────

/**
 * Event types available for notification configuration.
 */
const EVENT_TYPES = [
  "incoming_payment",
  "outgoing_payment",
  "escrow_release",
  "stream_claim",
  "multi_sig_approval",
  "price_alert",
  "scheduled_payment",
  "contract_event",
];

/**
 * Default event-channel config — all events on all channels.
 */
function defaultEventChannels() {
  const config = {};
  for (const event of EVENT_TYPES) {
    config[event] = { push: true, email: true, in_app: true };
  }
  return config;
}

/**
 * GET /api/notifications/:publicKey/preferences
 * Get unified notification preferences for a Stellar account.
 */
router.get(
  "/:publicKey/preferences",
  notificationLimiter,
  validate(publicKeyParamSchema, "params"),
  async (req, res, next) => {
    try {
      const { publicKey } = req.validated;
      const row = await knex("notification_preferences").where("public_key", publicKey).first();

      if (!row) {
        // Return defaults
        return res.json({
          success: true,
          preference: {
            publicKey,
            eventChannels: defaultEventChannels(),
            quietHoursEnabled: false,
            quietHoursStart: "22:00",
            quietHoursEnd: "07:00",
            timezone: "UTC",
            pushEnabled: true,
            emailEnabled: true,
            inAppEnabled: true,
          },
        });
      }

      return res.json({
        success: true,
        preference: {
          publicKey: row.public_key,
          eventChannels:
            typeof row.event_channels === "string"
              ? JSON.parse(row.event_channels)
              : row.event_channels || defaultEventChannels(),
          quietHoursEnabled: !!row.quiet_hours_enabled,
          quietHoursStart: row.quiet_hours_start,
          quietHoursEnd: row.quiet_hours_end,
          timezone: row.timezone,
          pushEnabled: !!row.push_enabled,
          emailEnabled: !!row.email_enabled,
          inAppEnabled: !!row.in_app_enabled,
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * PUT /api/notifications/:publicKey/preferences
 * Update unified notification preferences.
 *
 * Body: { eventChannels?, quietHoursEnabled?, quietHoursStart?, quietHoursEnd?,
 *         timezone?, pushEnabled?, emailEnabled?, inAppEnabled? }
 */
router.put(
  "/:publicKey/preferences",
  notificationLimiter,
  validate(publicKeyParamSchema, "params"),
  async (req, res, next) => {
    try {
      const { publicKey } = req.validated;
      const {
        eventChannels,
        quietHoursEnabled,
        quietHoursStart,
        quietHoursEnd,
        timezone,
        pushEnabled,
        emailEnabled,
        inAppEnabled,
      } = req.body;

      const existing = await knex("notification_preferences")
        .where("public_key", publicKey)
        .first();

      const channels =
        eventChannels ||
        (existing
          ? typeof existing.event_channels === "string"
            ? JSON.parse(existing.event_channels)
            : existing.event_channels
          : defaultEventChannels());

      const data = {
        public_key: publicKey,
        event_channels: JSON.stringify(channels),
        quiet_hours_enabled: quietHoursEnabled !== undefined ? quietHoursEnabled : false,
        quiet_hours_start: quietHoursStart || "22:00",
        quiet_hours_end: quietHoursEnd || "07:00",
        timezone: timezone || "UTC",
        push_enabled: pushEnabled !== undefined ? pushEnabled : true,
        email_enabled: emailEnabled !== undefined ? emailEnabled : true,
        in_app_enabled: inAppEnabled !== undefined ? inAppEnabled : true,
        updated_at: new Date().toISOString(),
      };

      if (existing) {
        await knex("notification_preferences").where("public_key", publicKey).update(data);
      } else {
        data.created_at = new Date().toISOString();
        await knex("notification_preferences").insert(data);
      }

      const saved = await knex("notification_preferences").where("public_key", publicKey).first();

      logger.info(
        {
          type: "notification_preferences_updated",
          publicKey,
        },
        "Notification preferences updated",
      );

      return res.json({
        success: true,
        preference: {
          publicKey: saved.public_key,
          eventChannels:
            typeof saved.event_channels === "string"
              ? JSON.parse(saved.event_channels)
              : saved.event_channels,
          quietHoursEnabled: !!saved.quiet_hours_enabled,
          quietHoursStart: saved.quiet_hours_start,
          quietHoursEnd: saved.quiet_hours_end,
          timezone: saved.timezone,
          pushEnabled: !!saved.push_enabled,
          emailEnabled: !!saved.email_enabled,
          inAppEnabled: !!saved.in_app_enabled,
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * GET /api/notifications/:publicKey/history
 * Get paginated notification history for a Stellar account.
 *
 * Query: ?page=1&limit=20
 */
router.get(
  "/:publicKey/history",
  notificationLimiter,
  validate(publicKeyParamSchema, "params"),
  async (req, res, next) => {
    try {
      const { publicKey } = req.validated;
      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
      const offset = (page - 1) * limit;

      const [{ count }] = await knex("notification_history")
        .where("public_key", publicKey)
        .count("* as count");

      const rows = await knex("notification_history")
        .where("public_key", publicKey)
        .orderBy("created_at", "desc")
        .limit(limit)
        .offset(offset);

      const items = rows.map((r) => ({
        id: r.id,
        eventType: r.event_type,
        message: r.message,
        channel: r.channel,
        read: !!r.read,
        createdAt: r.created_at,
      }));

      return res.json({
        success: true,
        history: items,
        pagination: {
          page,
          limit,
          total: parseInt(count, 10),
          totalPages: Math.ceil(parseInt(count, 10) / limit),
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * PUT /api/notifications/:publicKey/history/:id/read
 * Mark a notification history entry as read.
 */
router.put(
  "/:publicKey/history/:id/read",
  notificationLimiter,
  validate(publicKeyParamSchema, "params"),
  async (req, res, next) => {
    try {
      const { publicKey, id } = req.validated;
      await knex("notification_history")
        .where({ public_key: publicKey, id })
        .update({ read: true });

      return res.json({ success: true });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * DELETE /api/notifications/:publicKey/history
 * Clear all notification history for a Stellar account.
 */
router.delete(
  "/:publicKey/history",
  notificationLimiter,
  validate(publicKeyParamSchema, "params"),
  async (req, res, next) => {
    try {
      const { publicKey } = req.validated;
      await knex("notification_history").where("public_key", publicKey).del();

      return res.json({
        success: true,
        message: "Notification history cleared",
      });
    } catch (err) {
      next(err);
    }
  },
);

module.exports = router;

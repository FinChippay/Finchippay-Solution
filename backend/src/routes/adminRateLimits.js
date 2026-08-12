/**
 * src/routes/adminRateLimits.js
 * Admin API endpoints for rate limit configuration and analytics.
 */

"use strict";

const express = require("express");
const router = express.Router();
const knex = require("../db/connection");
const { verifyJWT, requireAdmin } = require("../middleware/auth");
const rateLimitConfigService = require("../services/rateLimitConfigService");
const { getRateLimitStats } = require("../middleware/rateLimitMetrics");
const logger = require("../utils/logger");

/**
 * GET /api/admin/rate-limits/stats
 * Returns rate limit analytics overview.
 */
router.get("/stats", verifyJWT, requireAdmin, async (req, res, next) => {
  try {
    const stats = getRateLimitStats();

    const oneMinuteAgo = new Date(Date.now() - 60000).toISOString();
    const [{ requestsPerMin }] = await knex("rate_limit_events")
      .where("occurred_at", ">=", oneMinuteAgo)
      .count("* as requestsPerMin");
    const [{ blocksPerMin }] = await knex("rate_limit_events")
      .where("blocked", true)
      .andWhere("occurred_at", ">=", oneMinuteAgo)
      .count("* as blocksPerMin");

    res.json({
      success: true,
      data: {
        requestsPerMin: parseInt(requestsPerMin, 10),
        blocksPerMin: parseInt(blocksPerMin, 10),
        topBlockedIps: stats.topLimitedIps,
        perRouteHitRates: stats.perRouteHitRates,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/admin/rate-limits
 * List current rate limit rules.
 */
router.get("/", verifyJWT, requireAdmin, async (req, res, next) => {
  try {
    const rules = await rateLimitConfigService.getAllRules();
    res.json({ success: true, rules });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/admin/rate-limits
 * Update a rate limit rule.
 * Body: { id: number, limit?: number, window_ms?: number, enabled?: boolean }
 */
router.put("/", verifyJWT, requireAdmin, async (req, res, next) => {
  try {
    const { id, limit, window_ms, enabled } = req.body;
    if (!id) return res.status(400).json({ error: "id is required" });

    const updated = await rateLimitConfigService.updateRule(id, {
      limit,
      window_ms,
      enabled,
    });
    logger.info(
      { type: "rate_limit_rule_updated", id, updated },
      "Rate limit rule updated by admin",
    );
    res.json({ success: true, rule: updated });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/admin/rate-limits/test
 * Simulate a request to preview if it would be blocked.
 * Body: { method: string, route: string, limit: number, windowMs: number }
 */
router.post("/test", verifyJWT, requireAdmin, async (req, res, next) => {
  try {
    const { method, route, limit, windowMs } = req.body;
    const result = await rateLimitConfigService.testRule(method, route, limit, windowMs);
    res.json({ success: true, result });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

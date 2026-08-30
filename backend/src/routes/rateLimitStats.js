/**
 * Admin-only rate-limit analytics.
 *
 * Mounted at: GET /api/admin/rate-limit-stats
 */

"use strict";

const express = require("express");
const strictLimiter = require("../middleware/rateLimit").strictLimiter;
const { verifyJWT, requireAdmin } = require("../middleware/auth");
const { getRateLimitStats } = require("../middleware/rateLimitMetrics");

const router = express.Router();

router.get("/", strictLimiter, verifyJWT, requireAdmin, (req, res) => {
  void req;
  res.json({
    success: true,
    data: getRateLimitStats(),
  });
});

module.exports = router;

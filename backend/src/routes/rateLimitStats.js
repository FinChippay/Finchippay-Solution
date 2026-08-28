/**
 * Admin-only rate-limit analytics.
 *
 * Mounted at: GET /api/admin/rate-limit-stats
 */

"use strict";

const express = require("express");
const { verifyJWT, requireAdmin } = require("../middleware/auth");
const { getRateLimitStats } = require("../middleware/rateLimitMetrics");

const router = express.Router();

router.get("/", verifyJWT, requireAdmin, (req, res) => {
  void req;
  res.json({
    success: true,
    data: getRateLimitStats(),
  });
});

module.exports = router;

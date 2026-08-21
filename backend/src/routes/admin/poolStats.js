"use strict";

const express = require("express");
const { getPoolStats } = require("../../db/connection");
const { sendError } = require("../../utils/errorResponse");

const router = express.Router();

function requireAdmin(req, res, next) {
  if (req.user && req.user.role && req.user.role !== "admin") {
    return sendError(res, "AUTH_FORBIDDEN", { message: "Admin access required" });
  }
  next();
}

router.use(requireAdmin);

/**
 * GET /api/v1/admin/db/pool-stats
 * Admin endpoint returning database connection pool metrics.
 */
router.get("/pool-stats", (req, res) => {
  try {
    const stats = getPoolStats();
    res.json(stats);
  } catch (err) {
    sendError(res, "SRV_INTERNAL", { details: { reason: err.message } });
  }
});

module.exports = router;

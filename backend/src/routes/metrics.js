/**
 * src/routes/metrics.js
 * Prometheus metrics exposition endpoint.
 *
 * GET /metrics
 *   Returns all registered metrics in Prometheus text format.
 *   Protected by `requireMetricsToken` middleware (Bearer auth via METRICS_TOKEN).
 */

"use strict";

const express = require("express");
const router = express.Router();
const metrics = require("../services/metricsService");
const { requireMetricsToken } = require("../middleware/metrics");
const logger = require("../utils/logger");
const { formatErrorResponse, ERROR_CODES } = require("../../../shared/errorCodes");

// ─── Rate-limit exemption note ────────────────────────────────────────────────
// The global rate limiter (applied in server.js before routes) caps at 100
// requests / 15 min which is generous for Prometheus scraping at typical
// intervals (15–60 s).  If you scrape more aggressively, move this route
// above the limiter or adjust the global window.

router.get("/", requireMetricsToken, async (req, res) => {
  try {
    const body = await metrics.getMetrics();
    res.setHeader("Content-Type", metrics.getContentType());
    res.send(body);
  } catch (err) {
    logger.error({ err }, "Failed to collect Prometheus metrics");
    res
      .status(ERROR_CODES.SRV_METRICS_FAILED.httpStatus)
      .json(formatErrorResponse("SRV_METRICS_FAILED"));
  }
});

module.exports = router;

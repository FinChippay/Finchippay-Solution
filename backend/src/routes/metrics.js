"use strict";

const express = require("express");
const router = express.Router();
const metrics = require("../services/metricsService");
const { requireMetricsToken } = require("../middleware/metrics");
const logger = require("../utils/logger");
const { formatErrorResponse, ERROR_CODES } = require("../../../shared/errorCodes");

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

router.get("/business", async (req, res) => {
  try {
    const activeGauge = metrics.register.getSingleMetric("finchippay_active_users");
    const paymentsCounter = metrics.register.getSingleMetric("finchippay_payments_volume_total");
    const eventsCounter = metrics.register.getSingleMetric(
      "finchippay_contract_events_indexed_total",
    );
    const webhookCounter = metrics.register.getSingleMetric("finchippay_webhook_deliveries_total");
    const durationHistogram = metrics.register.getSingleMetric(
      "finchippay_http_request_duration_seconds",
    );

    const snapshotValue = async (metric) => {
      if (!metric) return 0;
      const snap = await metric.get();
      if (snap.values && snap.values.length > 0) {
        return snap.values.reduce((sum, v) => sum + (v.value || 0), 0);
      }
      if (snap.value !== undefined) return snap.value;
      return 0;
    };

    const activeUsers24h = await snapshotValue(activeGauge);
    const paymentsToday = await snapshotValue(paymentsCounter);
    const totalEvents = await snapshotValue(eventsCounter);

    let webhookSuccessRate = 0;
    if (webhookCounter) {
      const snap = await webhookCounter.get();
      const total = snap.values ? snap.values.reduce((s, v) => s + (v.value || 0), 0) : 0;
      const success = snap.values
        ? snap.values
            .filter((v) => v.labels?.status === "success")
            .reduce((s, v) => s + (v.value || 0), 0)
        : 0;
      webhookSuccessRate = total > 0 ? success / total : 0;
    }

    let averageResponseTime = 0;
    if (durationHistogram) {
      const snap = await durationHistogram.get();
      const totalCount = snap.values
        ? snap.values
            .filter((v) => v.metricName?.endsWith("_count") || v.labels?.le === "+Inf")
            .reduce((s, v) => s + (v.value || 0), 0)
        : 0;
      const totalSum = snap.values
        ? snap.values
            .filter((v) => v.metricName?.endsWith("_sum"))
            .reduce((s, v) => s + (v.value || 0), 0)
        : 0;
      averageResponseTime = totalCount > 0 ? totalSum / totalCount : 0;
    }

    res.json({
      activeUsers24h: Math.round(activeUsers24h),
      paymentsToday: Math.round(paymentsToday),
      volumeTodayXLM: 0,
      totalEvents: Math.round(totalEvents),
      webhookSuccessRate: Math.round(webhookSuccessRate * 10000) / 10000,
      averageResponseTime: Math.round(averageResponseTime * 1000) / 1000,
    });
  } catch (err) {
    logger.error({ err }, "Failed to collect business metrics");
    res
      .status(ERROR_CODES.SRV_METRICS_FAILED.httpStatus)
      .json(formatErrorResponse("SRV_METRICS_FAILED"));
  }
});

module.exports = router;

/**
 * src/services/metricsService.js
 * Prometheus metrics for Finchippay Solution backend.
 *
 * Registers:
 *   - Default Node.js metrics (CPU, memory, event-loop lag, GC, etc.)
 *   - http_requests_total{method, route, status_code}          — Counter
 *   - http_request_duration_seconds{method, route}              — Histogram
 *   - horizon_requests_total{operation, status}                 — Counter
 *   - active_webhook_streams                                    — Gauge
 *
 * Usage:
 *   const metrics = require("./services/metricsService");
 *   metrics.httpRequestsTotal.inc({ method: "GET", route: "/api/health", status_code: 200 });
 */

"use strict";

const promClient = require("prom-client");
const logger = require("../utils/logger");

// ─── Prometheus Registry ──────────────────────────────────────────────────────

const register = new promClient.Registry();
promClient.collectDefaultMetrics({ register, prefix: "finchippay_" });

// ─── Custom Metrics ───────────────────────────────────────────────────────────

/**
 * HTTP request counter — incremented once per completed request.
 * Labels: method, route, status_code
 */
const httpRequestsTotal = new promClient.Counter({
  name: "http_requests_total",
  help: "Total number of HTTP requests handled by the backend, labeled by HTTP method, route, and response status code.",
  labelNames: ["method", "route", "status_code"],
  registers: [register],
});

/**
 * HTTP request duration histogram — observes the full request-response round-trip.
 * Labels: method, route
 *
 * Buckets (seconds): 0.05, 0.1, 0.5, 1, 2, 5 — covers sub-100 ms API
 * calls through long-tail timeouts, aligned with the acceptance criteria.
 */
const httpRequestDurationSeconds = new promClient.Histogram({
  name: "http_request_duration_seconds",
  help: "Duration of HTTP requests in seconds, labeled by HTTP method and matched route.",
  labelNames: ["method", "route"],
  buckets: [0.05, 0.1, 0.5, 1, 2, 5],
  registers: [register],
});

/**
 * Horizon API request counter — incremented for every call to the Stellar
 * Horizon server (account loads, payment history, SSE subscriptions).
 * Labels: operation, status
 */
const horizonRequestsTotal = new promClient.Counter({
  name: "horizon_requests_total",
  help: "Total number of requests made to the Stellar Horizon API, labeled by operation type and outcome (success / error).",
  labelNames: ["operation", "status"],
  registers: [register],
});

/**
 * Active Horizon SSE webhook streams — tracks the number of concurrently
 * open SSE connections monitoring Stellar accounts for incoming payments.
 */
const activeWebhookStreams = new promClient.Gauge({
  name: "active_webhook_streams",
  help: "Number of currently active Horizon SSE streams watching for payment events.",
  registers: [register],
});

/**
 * Rate-limit decisions, including both allowed and blocked requests.
 * Labels: route, limiter_type, status ("allowed" or "blocked")
 */
const rateLimitHitsTotal = new promClient.Counter({
  name: "rate_limit_hits_total",
  help: "Total number of rate-limit decisions by normalized route, limiter type, and outcome.",
  labelNames: ["route", "limiter_type", "status"],
  registers: [register],
});

/**
 * Requests rejected by a rate limiter.
 *
 * The `ip` label contains an HMAC-SHA256 digest, never a raw IP address.
 * Labels: route, ip
 */
const rateLimitBreachesTotal = new promClient.Counter({
  name: "rate_limit_breaches_total",
  help: "Total number of rejected requests by normalized route and privacy-preserving client hash.",
  labelNames: ["route", "ip"],
  registers: [register],
});

/**
 * Requests allowed to continue past an instrumented rate limiter.
 * Labels: route, limiter_type
 */
const rateLimitBypassedTotal = new promClient.Counter({
  name: "rate_limit_bypassed_total",
  help: "Total number of requests allowed to continue past a rate limiter.",
  labelNames: ["route", "limiter_type"],
  registers: [register],
});

// ─── Metrics exposition ───────────────────────────────────────────────────────

/**
 * Return the metrics in Prometheus text format.
 * @returns {Promise<string>}
 */
async function getMetrics() {
  return register.metrics();
}

/**
 * Return the content type for the Prometheus exposition format.
 * @returns {string}
 */
function getContentType() {
  return register.contentType;
}

// ─── Boot log ─────────────────────────────────────────────────────────────────

logger.info(
  "Prometheus metrics registered: http_requests_total, http_request_duration_seconds, horizon_requests_total, active_webhook_streams, rate_limit_hits_total, rate_limit_breaches_total, rate_limit_bypassed_total",
);

module.exports = {
  register,
  httpRequestsTotal,
  httpRequestDurationSeconds,
  horizonRequestsTotal,
  activeWebhookStreams,
  rateLimitHitsTotal,
  rateLimitBreachesTotal,
  rateLimitBypassedTotal,
  getMetrics,
  getContentType,
};

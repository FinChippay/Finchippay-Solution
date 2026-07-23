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
 *   - rate_limit_hits_total{limiter, route}                     — Counter
 *   - webhook_deliveries_total{outcome, status_code}            — Counter
 *   - webhook_delivery_duration_seconds{outcome}                — Histogram
 *   - contract_events_processed_total{outcome}                  — Counter
 *   - contract_event_indexer_lag_ledgers                        — Gauge
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
 * Rate limiter rejections — incremented when a limiter blocks a request.
 * Labels: limiter (strict | sensitive | global), route
 *
 * Distinct from `http_requests_total{status_code="429"}`: this attributes the
 * rejection to the limiter that produced it, which is what tells an operator
 * whether to raise a specific limit or investigate an abusive client.
 */
const rateLimitHitsTotal = new promClient.Counter({
  name: "rate_limit_hits_total",
  help: "Total number of requests rejected by a rate limiter, labeled by which limiter rejected it and the route requested.",
  labelNames: ["limiter", "route"],
  registers: [register],
});

/**
 * Webhook delivery attempts.
 * Labels: outcome (success | failed | error), status_code
 *
 * `failed` is a delivered request the receiver rejected (non-2xx); `error` is a
 * request that never completed (DNS, timeout, connection refused). They are
 * separated because they point at different problems — the receiver's, or ours.
 * `status_code` is "none" for `error`, since no response was received.
 */
const webhookDeliveriesTotal = new promClient.Counter({
  name: "webhook_deliveries_total",
  help: "Total webhook delivery attempts, labeled by outcome (success / failed / error) and the HTTP status returned by the receiver.",
  labelNames: ["outcome", "status_code"],
  registers: [register],
});

/**
 * Webhook delivery latency, measured around the outbound HTTP request.
 * Labels: outcome
 *
 * Buckets (seconds): 0.1 through 30 — receivers are third-party endpoints, so
 * the long tail matters more than it does for our own API.
 */
const webhookDeliveryDurationSeconds = new promClient.Histogram({
  name: "webhook_delivery_duration_seconds",
  help: "Duration of outbound webhook delivery requests in seconds, labeled by outcome.",
  labelNames: ["outcome"],
  buckets: [0.1, 0.25, 0.5, 1, 2, 5, 10, 30],
  registers: [register],
});

/**
 * Soroban contract events handled by the indexer.
 * Labels: outcome (indexed | parse_failed)
 *
 * `indexed` counts events written to storage; `parse_failed` counts events the
 * indexer could not decode and skipped. A rising `parse_failed` rate usually
 * means the contract emitted a shape the indexer does not know about.
 */
const contractEventsProcessedTotal = new promClient.Counter({
  name: "contract_events_processed_total",
  help: "Total Soroban contract events processed by the indexer, labeled by outcome (indexed / parse_failed).",
  labelNames: ["outcome"],
  registers: [register],
});

/**
 * How far the indexer trails the network, in ledgers.
 *
 * Measured at the start of each poll as (latest ledger - last processed
 * ledger). This is the backlog signal: a steady value means the indexer is
 * keeping up, a climbing one means it is falling behind.
 */
const contractEventIndexerLagLedgers = new promClient.Gauge({
  name: "contract_event_indexer_lag_ledgers",
  help: "Number of ledgers between the latest network ledger and the last one the event indexer processed.",
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
  {
    metrics: register
      .getMetricsAsArray()
      .map((m) => m.name)
      .filter((name) => !name.startsWith("finchippay_")),
  },
  "Prometheus metrics registered",
);

module.exports = {
  register,
  httpRequestsTotal,
  httpRequestDurationSeconds,
  horizonRequestsTotal,
  activeWebhookStreams,
  rateLimitHitsTotal,
  webhookDeliveriesTotal,
  webhookDeliveryDurationSeconds,
  contractEventsProcessedTotal,
  contractEventIndexerLagLedgers,
  getMetrics,
  getContentType,
};

"use strict";

const promClient = require("prom-client");
const logger = require("../utils/logger");

const register = new promClient.Registry();
promClient.collectDefaultMetrics({ register, prefix: "finchippay_" });

const httpRequestsTotal = new promClient.Counter({
  name: "http_requests_total",
  help: "Total number of HTTP requests handled by the backend, labeled by HTTP method, route, and response status code.",
  labelNames: ["method", "route", "status_code"],
  registers: [register],
});

const httpRequestDurationSeconds = new promClient.Histogram({
  name: "http_request_duration_seconds",
  help: "Duration of HTTP requests in seconds, labeled by method, route, and status code.",
  labelNames: ["method", "route", "status_code"],
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5],
  registers: [register],
});

const httpRequestsInFlight = new promClient.Gauge({
  name: "http_requests_in_flight",
  help: "Number of HTTP requests currently being processed, labeled by method and route.",
  labelNames: ["method", "route"],
  registers: [register],
});

const dbQueryDurationSeconds = new promClient.Histogram({
  name: "db_query_duration_seconds",
  help: "Duration of database queries in seconds, labeled by operation.",
  labelNames: ["operation"],
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1],
  registers: [register],
});

const horizonRequestDurationSeconds = new promClient.Histogram({
  name: "horizon_request_duration_seconds",
  help: "Duration of Horizon API requests in seconds, labeled by operation.",
  labelNames: ["operation"],
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5, 10],
  registers: [register],
});

const horizonRequestsTotal = new promClient.Counter({
  name: "horizon_requests_total",
  help: "Total number of requests made to the Stellar Horizon API, labeled by operation type and outcome.",
  labelNames: ["operation", "status"],
  registers: [register],
});

const webhookDeliveriesTotal = new promClient.Counter({
  name: "webhook_deliveries_total",
  help: "Total number of webhook delivery attempts, labeled by status (success, failed, retrying).",
  labelNames: ["status"],
  registers: [register],
});

const contractEventsIndexedTotal = new promClient.Counter({
  name: "contract_events_indexed_total",
  help: "Total number of contract events indexed, labeled by event type.",
  labelNames: ["event_type"],
  registers: [register],
});

const activeUsers = new promClient.Gauge({
  name: "active_users",
  help: "Number of active users in the last 24 hours, updated every 5 minutes via cron.",
  registers: [register],
});

const paymentsVolumeTotal = new promClient.Counter({
  name: "payments_volume_total",
  help: "Total volume of payments processed, labeled by asset type.",
  labelNames: ["asset"],
  registers: [register],
});

const errorCountTotal = new promClient.Counter({
  name: "error_count_total",
  help: "Total number of errors by service and error code.",
  labelNames: ["service", "error_code"],
  registers: [register],
});

const activeWebhookStreams = new promClient.Gauge({
  name: "active_webhook_streams",
  help: "Number of currently active Horizon SSE streams watching for payment events.",
  registers: [register],
});

const rateLimitHitsTotal = new promClient.Counter({
  name: "rate_limit_hits_total",
  help: "Total number of rate-limit decisions by normalized route, limiter type, and outcome.",
  labelNames: ["route", "limiter_type", "status"],
  registers: [register],
});

const rateLimitBreachesTotal = new promClient.Counter({
  name: "rate_limit_breaches_total",
  help: "Total number of rejected requests by normalized route and privacy-preserving client hash.",
  labelNames: ["route", "ip"],
  registers: [register],
});

const rateLimitBypassedTotal = new promClient.Counter({
  name: "rate_limit_bypassed_total",
  help: "Total number of requests allowed to continue past a rate limiter.",
  labelNames: ["route", "limiter_type"],
  registers: [register],
});

const emailsSentTotal = new promClient.Counter({
  name: "emails_sent_total",
  help: "Total number of emails successfully sent.",
  registers: [register],
});
const emailsFailedTotal = new promClient.Counter({
  name: "emails_failed_total",
  help: "Total number of emails that failed after exhausting retries.",
  registers: [register],
});
const emailsRateLimitedTotal = new promClient.Counter({
  name: "emails_rate_limited_total",
  help: "Total number of emails dropped due to per-user rate limiting.",
  registers: [register],
});

async function getMetrics() {
  return register.metrics();
}

function getContentType() {
  return register.contentType;
}

logger.info(
  "Prometheus metrics registered: http_requests_total, http_request_duration_seconds, http_requests_in_flight, db_query_duration_seconds, horizon_request_duration_seconds, horizon_requests_total, webhook_deliveries_total, contract_events_indexed_total, active_users, payments_volume_total, error_count_total, active_webhook_streams, rate_limit_hits_total, rate_limit_breaches_total, rate_limit_bypassed_total",
);

module.exports = {
  register,
  httpRequestsTotal,
  httpRequestDurationSeconds,
  httpRequestsInFlight,
  dbQueryDurationSeconds,
  horizonRequestDurationSeconds,
  horizonRequestsTotal,
  webhookDeliveriesTotal,
  contractEventsIndexedTotal,
  activeUsers,
  paymentsVolumeTotal,
  errorCountTotal,
  activeWebhookStreams,
  rateLimitHitsTotal,
  rateLimitBreachesTotal,
  rateLimitBypassedTotal,
  emailsSentTotal,
  emailsFailedTotal,
  emailsRateLimitedTotal,
  getMetrics,
  getContentType,
};



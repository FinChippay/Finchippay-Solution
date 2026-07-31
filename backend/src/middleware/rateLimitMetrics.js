/**
 * Privacy-preserving rate-limit metrics and rolling analytics.
 *
 * express-rate-limit v7 removed the onLimitReached option, so blocked
 * requests are observed through its custom handler. Allowed requests are
 * recorded by the wrapper in rateLimit.js.
 */

"use strict";

const crypto = require("crypto");
const metrics = require("../services/metricsService");

const STATS_WINDOW_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MAX_EVENTS = 10_000;
const MAX_CONFIGURED_EVENTS = 100_000;
const fallbackHashSalt = crypto.randomBytes(32);
const API_ROUTE_FAMILIES = new Set([
  "accounts",
  "admin",
  "analytics",
  "auth",
  "docs",
  "events",
  "features",
  "health",
  "parse-payment",
  "payments",
  "scheduled-transactions",
  "sep12",
  "sep24",
  "tips",
  "turrets",
  "webhooks",
]);
const ROOT_ROUTE_FAMILIES = new Set([
  ".well-known",
  "federation",
  "health",
  "metrics",
]);

let decisionHistory = [];

function getMaxEvents() {
  const configured = Number.parseInt(
    process.env.RATE_LIMIT_METRICS_MAX_EVENTS,
    10,
  );

  if (!Number.isFinite(configured) || configured < 100) {
    return DEFAULT_MAX_EVENTS;
  }

  return Math.min(configured, MAX_CONFIGURED_EVENTS);
}

function asTimestamp(value = Date.now()) {
  const timestamp = value instanceof Date ? value.getTime() : Number(value);
  return Number.isFinite(timestamp) ? timestamp : Date.now();
}

function normaliseClientIp(ip) {
  return String(ip || "unknown")
    .trim()
    .toLowerCase()
    .replace(/^::ffff:/, "");
}

/**
 * Convert a client IP into an opaque, stable process identifier.
 *
 * Production deployments should configure RATE_LIMIT_IP_HASH_SALT. A random
 * process-local key is used when it is absent so raw IP addresses are never
 * exposed, even during local development.
 */
function hashIp(ip) {
  const salt = process.env.RATE_LIMIT_IP_HASH_SALT || fallbackHashSalt;
  return crypto
    .createHmac("sha256", salt)
    .update(normaliseClientIp(ip))
    .digest("hex");
}

function normalisePath(path) {
  const withoutQuery = String(path || "/").split("?")[0] || "/";
  const withLeadingSlash = withoutQuery.startsWith("/")
    ? withoutQuery
    : `/${withoutQuery}`;

  return withLeadingSlash
    .replace(/\/{2,}/g, "/")
    .replace(
      /\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?=\/|$)/gi,
      "/:id",
    )
    .replace(/\/[GS][A-Z2-7]{55}(?=\/|$)/g, "/:publicKey")
    .replace(/\/\d+(?=\/|$)/g, "/:id")
    .replace(/\/[0-9a-f]{32,}(?=\/|$)/gi, "/:id");
}

function normaliseUnmatchedRouteFamily(path) {
  const segments = normalisePath(path).split("/").filter(Boolean);

  if (segments[0] === "api") {
    const family = API_ROUTE_FAMILIES.has(segments[1]) ? segments[1] : "other";
    return `/api/${family}/*`;
  }

  if (ROOT_ROUTE_FAMILIES.has(segments[0])) {
    return `/${segments[0]}/*`;
  }

  return "/unmatched";
}

/**
 * Return a bounded-cardinality route label using the matched Express route
 * whenever possible. Before Express resolves a route (for example, when the
 * global limiter blocks a request), use a fixed route-family label rather than
 * placing attacker-controlled path segments in Prometheus.
 */
function normaliseRateLimitRoute(req = {}) {
  const routePath = req.route?.path;
  let path;

  if (typeof routePath === "string") {
    const baseUrl =
      req.baseUrl && req.baseUrl !== "/" ? String(req.baseUrl) : "";
    path = `${baseUrl}${routePath === "/" ? "" : routePath}` || "/";
  } else {
    path = req.path || req.originalUrl || "/";
    if (
      req.baseUrl &&
      req.baseUrl !== "/" &&
      !String(path).startsWith(String(req.baseUrl))
    ) {
      path = `${req.baseUrl}${String(path).startsWith("/") ? "" : "/"}${path}`;
    }
    path = normaliseUnmatchedRouteFamily(path);
  }

  const method = String(req.method || "UNKNOWN").toUpperCase();
  return `${method} ${normalisePath(path)}`;
}

function pruneHistory(now = Date.now()) {
  const nowMs = asTimestamp(now);
  const cutoff = nowMs - STATS_WINDOW_MS;

  decisionHistory = decisionHistory.filter(
    (event) => event.timestampMs >= cutoff,
  );

  const maxEvents = getMaxEvents();
  if (decisionHistory.length > maxEvents) {
    decisionHistory = decisionHistory.slice(-maxEvents);
  }
}

function addDecision(req, limiterType, status, timestamp = Date.now()) {
  const timestampMs = asTimestamp(timestamp);
  const event = {
    timestampMs,
    timestamp: new Date(timestampMs).toISOString(),
    route: normaliseRateLimitRoute(req),
    limiterType: String(limiterType || "unknown"),
    status,
  };

  if (status === "blocked") {
    event.ipHash = hashIp(req.ip || req.socket?.remoteAddress);
  }

  decisionHistory.push(event);
  const maxEvents = getMaxEvents();
  if (decisionHistory.length > maxEvents) {
    decisionHistory = decisionHistory.slice(-maxEvents);
  }
  return event;
}

function recordRateLimitAllowed(req, limiterType, timestamp) {
  const event = addDecision(req, limiterType, "allowed", timestamp);

  metrics.rateLimitHitsTotal.inc({
    route: event.route,
    limiter_type: event.limiterType,
    status: event.status,
  });
  metrics.rateLimitBypassedTotal.inc({
    route: event.route,
    limiter_type: event.limiterType,
  });

  return event;
}

function recordRateLimitBreach(req, limiterType, timestamp) {
  const event = addDecision(req, limiterType, "blocked", timestamp);

  metrics.rateLimitHitsTotal.inc({
    route: event.route,
    limiter_type: event.limiterType,
    status: event.status,
  });
  metrics.rateLimitBreachesTotal.inc({
    route: event.route,
    ip: event.ipHash,
  });

  return event;
}

/**
 * express-rate-limit v7 replacement for the removed onLimitReached callback.
 */
function onLimitReached(
  req,
  res,
  next,
  options,
  limiterType,
  configuredHandler,
) {
  recordRateLimitBreach(req, limiterType);

  if (typeof configuredHandler === "function") {
    return configuredHandler(req, res, next, options);
  }

  return res.status(options.statusCode || 429).send(options.message);
}

function createRateLimitHandler(limiterType, configuredHandler) {
  return (req, res, next, options) =>
    onLimitReached(req, res, next, options, limiterType, configuredHandler);
}

function getRateLimitStats(now = Date.now()) {
  const nowMs = asTimestamp(now);
  pruneHistory(nowMs);

  const routeTotals = new Map();
  const ipTotals = new Map();

  for (const event of decisionHistory) {
    const routeKey = `${event.route}\u0000${event.limiterType}`;
    const routeStats = routeTotals.get(routeKey) || {
      route: event.route,
      limiterType: event.limiterType,
      allowed: 0,
      blocked: 0,
      total: 0,
    };

    routeStats[event.status] += 1;
    routeStats.total += 1;
    routeTotals.set(routeKey, routeStats);

    if (event.status === "blocked") {
      ipTotals.set(event.ipHash, (ipTotals.get(event.ipHash) || 0) + 1);
    }
  }

  const topLimitedIps = [...ipTotals.entries()]
    .map(([ipHash, breaches]) => ({ ipHash, breaches }))
    .sort(
      (left, right) =>
        right.breaches - left.breaches ||
        left.ipHash.localeCompare(right.ipHash),
    )
    .slice(0, 10);

  const perRouteHitRates = [...routeTotals.values()]
    .map((entry) => ({
      ...entry,
      breachRate:
        entry.total === 0
          ? 0
          : Number((entry.blocked / entry.total).toFixed(4)),
    }))
    .sort(
      (left, right) =>
        right.total - left.total ||
        left.route.localeCompare(right.route) ||
        left.limiterType.localeCompare(right.limiterType),
    );

  const breachHistory = decisionHistory
    .filter((event) => event.status === "blocked")
    .sort((left, right) => right.timestampMs - left.timestampMs)
    .map(({ timestamp, route, limiterType, ipHash }) => ({
      timestamp,
      route,
      limiterType,
      ipHash,
    }));

  return { topLimitedIps, perRouteHitRates, breachHistory };
}

function resetRateLimitStats() {
  decisionHistory = [];
}

module.exports = {
  STATS_WINDOW_MS,
  createRateLimitHandler,
  getRateLimitStats,
  hashIp,
  normaliseRateLimitRoute,
  onLimitReached,
  recordRateLimitAllowed,
  recordRateLimitBreach,
  resetRateLimitStats,
};

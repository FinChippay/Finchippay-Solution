/**
 * src/middleware/metrics.js
 * Express middleware for Prometheus metrics collection and endpoint protection.
 *
 * Exports two middlewares:
 *   1. trackHttpMetrics   — observes duration & increments request counter
 *                           for every API route (mounted before route handlers).
 *   2. requireMetricsToken — protects GET /metrics with Bearer token auth
 *                           using the METRICS_TOKEN env var.
 */

"use strict";

const metrics = require("../services/metricsService");
const { formatErrorResponse, ERROR_CODES } = require("../../../shared/errorCodes");

// ─── Route normalisation ──────────────────────────────────────────────────────

/**
 * Reduce dynamic Express route paths like "/api/payments/:id" to a stable
 * cardinality label.  Without this every unique account ID would create a
 * new time-series, blowing up Prometheus storage.
 *
 * Express stores the matched pattern at `req.route.path` (e.g. "/", "/:id").
 * We combine it with the mount path from `req.baseUrl` where available.
 *
 * @param {import("express").Request} req
 * @returns {string}  e.g. "GET /api/payments/:id"
 */
function normalisedRoute(req) {
  let path = req.route?.path ?? req.path ?? "/";
  // When the route is mounted on a sub-path (e.g. router.use("/payments", …)),
  // req.baseUrl holds the mount prefix and req.route.path holds the suffix.
  if (req.baseUrl && req.baseUrl !== "/" && req.route) {
    path = req.baseUrl + (req.route.path === "/" ? "" : req.route.path);
  }
  return `${req.method} ${path}`;
}

// ─── HTTP Metrics Middleware ──────────────────────────────────────────────────

/**
 * Track every completed HTTP request with a duration observation and a
 * counter increment.  Attach the start time via `res.locals` inside a
 * tiny inline handler so the caller only needs `app.use(trackHttpMetrics)`.
 *
 * @param {import("express").Request}  req
 * @param {import("express").Response} res
 * @param {import("express").NextFunction} next
 */
function trackHttpMetrics(req, res, next) {
  const start = process.hrtime.bigint();

  // Capture the matched route *after* Express resolves it (the "finish" event).
  res.once("finish", () => {
    const route = normalisedRoute(req);
    const durationSec = Number(process.hrtime.bigint() - start) / 1e9;

    metrics.httpRequestDurationSeconds.observe({ method: req.method, route }, durationSec);
    metrics.httpRequestsTotal.inc({
      method: req.method,
      route,
      status_code: res.statusCode,
    });
  });

  next();
}

// ─── Metrics Endpoint Auth Middleware ─────────────────────────────────────────

/**
 * Protect the /metrics endpoint with Bearer authentication.
 *
 * Reads the token from the `METRICS_TOKEN` env var.  When METRICS_TOKEN is not
 * set the middleware logs a warning and allows all requests — this keeps local
 * development frictionless while preventing accidental exposure in production.
 *
 * @param {import("express").Request}  req
 * @param {import("express").Response} res
 * @param {import("express").NextFunction} next
 */
function requireMetricsToken(req, res, next) {
  const expectedToken = process.env.METRICS_TOKEN;

  if (!expectedToken) {
    // No token configured — allow open access with a loud warning.
    if (process.env.NODE_ENV !== "test") {
      console.warn(
        "⚠️  METRICS_TOKEN is not set — /metrics endpoint is unprotected. " +
          "Set METRICS_TOKEN in production to secure Prometheus scraping."
      );
    }
    return next();
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.setHeader("WWW-Authenticate", 'Bearer realm="metrics"');
    return res
      .status(ERROR_CODES.AUTH_MISSING_HEADER.httpStatus)
      .json(formatErrorResponse("AUTH_MISSING_HEADER"));
  }

  const token = authHeader.split(" ")[1];
  if (token !== expectedToken) {
    return res
      .status(ERROR_CODES.AUTH_INVALID_TOKEN.httpStatus)
      .json(formatErrorResponse("AUTH_INVALID_TOKEN", { reason: "Invalid metrics token." }));
  }

  next();
}

module.exports = { trackHttpMetrics, requireMetricsToken, normalisedRoute };

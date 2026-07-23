"use strict";

const rateLimit = require("express-rate-limit");
const { formatErrorResponse } = require("../../../shared/errorCodes");
const metrics = require("../services/metricsService");

/**
 * Build the `handler` a limiter uses when a request is over the limit.
 *
 * express-rate-limit only calls this on rejection, so it is the exact point to
 * count from. `req.route` is undefined here — the limiter runs before the route
 * matches — so the label uses the mounted path, which keeps cardinality bounded
 * by the number of routes rather than by the number of distinct URLs.
 *
 * @param {string} name - Limiter name used as the `limiter` label.
 * @param {string} errorCode - Catalogue code to return.
 */
function limitHandler(name, errorCode) {
  return (req, res) => {
    metrics.rateLimitHitsTotal.inc({
      limiter: name,
      route: req.baseUrl || req.path || "unknown",
    });
    res
      .status(429)
      .json(formatErrorResponse(errorCode));
  };
}

let store;

if (process.env.REDIS_URL) {
  const Redis = require("ioredis");
  const RedisStore = require("rate-limit-redis").default;

  const client = new Redis(process.env.REDIS_URL, {
    enableOfflineQueue: false,
    maxRetriesPerRequest: null,
  });

  client.on("error", (err) => {
    console.error("Redis rate-limit client error:", err);
  });

  store = new RedisStore({
    sendCommand: (...args) => client.call(...args),
    prefix: "rl:",
    resetExpiryOnChange: true,
  });
}

const strictLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: formatErrorResponse("RATE_LIMITED_SENSITIVE"),
  handler: limitHandler("strict", "RATE_LIMITED_SENSITIVE"),
  ...(store ? { store } : {}),
});

const sensitiveLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: formatErrorResponse("RATE_LIMITED_SENSITIVE"),
  handler: limitHandler("sensitive", "RATE_LIMITED_SENSITIVE"),
  ...(store ? { store } : {}),
});

module.exports = { strictLimiter, sensitiveLimiter, limitHandler };

"use strict";

const rateLimit = require("express-rate-limit");
const { formatErrorResponse } = require("../../../shared/errorCodes");
const {
  createRateLimitHandler,
  recordRateLimitAllowed,
} = require("./rateLimitMetrics");

let redisClient;
let RedisStore;

if (process.env.REDIS_URL) {
  const Redis = require("ioredis");
  RedisStore = require("rate-limit-redis").default;

  redisClient = new Redis(process.env.REDIS_URL, {
    enableOfflineQueue: false,
    maxRetriesPerRequest: null,
  });

  redisClient.on("error", (err) => {
    console.error("Redis rate-limit client error:", err);
  });
}

function createRedisStore(limiterType) {
  if (!redisClient || !RedisStore) {
    return undefined;
  }

  return new RedisStore({
    sendCommand: (...args) => redisClient.call(...args),
    prefix: `rl:${limiterType}:`,
    resetExpiryOnChange: true,
  });
}

/**
 * Build an express-rate-limit middleware with Prometheus and rolling stats
 * instrumentation. The wrapper records an allowed decision only when the
 * limiter calls next; the custom v7 handler records every blocked request.
 */
function createInstrumentedLimiter(options, limiterType) {
  const type = String(limiterType || "unknown");
  const { handler: configuredHandler, ...limiterOptions } = options;
  const limiter = rateLimit({
    ...limiterOptions,
    handler: createRateLimitHandler(type, configuredHandler),
  });

  const instrumentedLimiter = (req, res, next) =>
    limiter(req, res, (err) => {
      if (err) {
        return next(err);
      }

      const nextResult = next();
      recordRateLimitAllowed(req, type);
      return nextResult;
    });

  for (const method of ["resetKey", "getKey"]) {
    if (typeof limiter[method] === "function") {
      instrumentedLimiter[method] = limiter[method].bind(limiter);
    }
  }

  return instrumentedLimiter;
}

const strictLimiter = createInstrumentedLimiter(
  {
    windowMs: 1 * 60 * 1000,
    limit: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: formatErrorResponse("RATE_LIMITED_SENSITIVE"),
    ...(redisClient ? { store: createRedisStore("strict") } : {}),
  },
  "strict",
);

const sensitiveLimiter = createInstrumentedLimiter(
  {
    windowMs: 1 * 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: formatErrorResponse("RATE_LIMITED_SENSITIVE"),
    ...(redisClient ? { store: createRedisStore("sensitive") } : {}),
  },
  "sensitive",
);

module.exports = {
  createInstrumentedLimiter,
  sensitiveLimiter,
  strictLimiter,
};

"use strict";

const rateLimit = require("express-rate-limit");
const { formatErrorResponse } = require("../../../shared/errorCodes");

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
  ...(store ? { store } : {}),
});

const sensitiveLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: formatErrorResponse("RATE_LIMITED_SENSITIVE"),
  ...(store ? { store } : {}),
});

module.exports = { strictLimiter, sensitiveLimiter };

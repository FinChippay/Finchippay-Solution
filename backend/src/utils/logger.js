/**
 * src/utils/logger.js
 * Shared Pino structured JSON logger.
 *
 * A mixin pulls `requestId` / `sessionId` (and `correlationId` alias) from
 * AsyncLocalStorage so every log line emitted during a request is automatically
 * correlated — including calls that still use the root `logger` instead of
 * `req.log`.
 *
 * All log output is scrubbed of Stellar secret keys ('S' + 55 base32 chars)
 * via a `logMethod` hook, so a mis-routed key never appears in logs.
 */

"use strict";

const pino = require("pino");

const isProduction = process.env.NODE_ENV === "production";

const STELLAR_SECRET_KEY_PATTERN = /S[A-Z2-7]{55}/g;
const REDACTED_STELLAR = "[REDACTED_STELLAR_SECRET]";

/**
 * Recursively scrub Stellar secret keys from strings, errors, and plain
 * objects. Objects are serialised, scrubbed, and re-parsed so keys nested at
 * any depth are caught without mutating callers' data.
 *
 * @param {*} obj value to scrub
 * @returns {*} the scrubbed value (same reference for non-strings/objects)
 */
function redactStellarKeys(obj) {
  if (typeof obj === "string") {
    return obj.replace(STELLAR_SECRET_KEY_PATTERN, REDACTED_STELLAR);
  }
  if (obj instanceof Error) {
    obj.message = obj.message.replace(STELLAR_SECRET_KEY_PATTERN, REDACTED_STELLAR);
    if (obj.stack) {
      obj.stack = obj.stack.replace(STELLAR_SECRET_KEY_PATTERN, REDACTED_STELLAR);
    }
    return obj;
  }
  if (obj && typeof obj === "object") {
    try {
      const str = JSON.stringify(obj);
      if (STELLAR_SECRET_KEY_PATTERN.test(str)) {
        return JSON.parse(str.replace(STELLAR_SECRET_KEY_PATTERN, REDACTED_STELLAR));
      }
    } catch {
      /* non-serialisable — leave as-is */
    }
  }
  return obj;
}

let transport = undefined;
if (!isProduction) {
  try {
    require.resolve("pino-pretty");
    transport = {
      target: "pino-pretty",
      options: {
        colorize: true,
        translateTime: "SYS:standard",
        ignore: "pid,hostname",
      },
    };
  } catch {
    // pino-pretty not installed — fall back to JSON output in development too.
  }
}

const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  base: { service: "finchippay-backend" },
  mixin() {
    const { getRequestId } = require("./correlationId");
    const correlationId = getRequestId();
    return correlationId ? { correlationId } : {};
  },
  formatters: {
    level: (label) => ({ level: label.toUpperCase() }),
    bindings: (bindings) => ({ service: "finchippay-backend", ...bindings }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  serializers: {
    err: (err) => redactStellarKeys(err),
    error: (err) => redactStellarKeys(err),
  },
  // Redact common secret-bearing keys; free-form strings are scrubbed in hooks.
  redact: {
    paths: [
      "privateKey",
      "secret",
      "secretKey",
      "seed",
      "password",
      "token",
      "signature",
      "jwt",
      "authorization",
      "apiKey",
      "api_key",
      "accessToken",
      "access_token",
      "refreshToken",
      "refresh_token",
      "*.secret",
      "*.secretKey",
      "*.privateKey",
      "req.headers.authorization",
    ],
    censor: "[REDACTED]",
  },
  hooks: {
    logMethod(inputArgs, method) {
      const args = inputArgs.map((arg) => redactStellarKeys(arg));
      return method.apply(this, args);
    },
  },
  ...(transport ? { transport } : {}),
});

module.exports = logger;

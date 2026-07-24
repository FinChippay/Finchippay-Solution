/**
 * src/utils/logger.js
 * Shared Pino structured JSON logger.
 *
 * A mixin pulls `requestId` / `sessionId` from AsyncLocalStorage so every
 * log line emitted during a request is automatically correlated — including
 * calls that still use the root `logger` instead of `req.log`.
 */

"use strict";

const pino = require("pino");

// Lazy require avoids circular init issues if correlationId ever imports logger.
function getCorrelationFields() {
  try {
    const {
      getRequestId,
      getSessionId,
    } = require("./correlationId");
    const requestId = getRequestId();
    const sessionId = getSessionId();
    const fields = {};
    if (requestId) fields.requestId = requestId;
    if (sessionId) fields.sessionId = sessionId;
    return fields;
  } catch {
    return {};
  }
}

const STELLAR_SECRET_PATTERN = /S[A-Z2-7]{55}/g;

const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  mixin() {
    return getCorrelationFields();
  },
  formatters: {
    level: (label) => {
      return { level: label.toUpperCase() };
    },
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  // Redact common secret-bearing keys; message strings are also scrubbed below.
  redact: {
    paths: [
      "secret",
      "secretKey",
      "privateKey",
      "seed",
      "*.secret",
      "*.secretKey",
      "*.privateKey",
      "req.headers.authorization",
    ],
    censor: "[REDACTED]",
  },
  hooks: {
    logMethod(inputArgs, method) {
      // Scrub Stellar secret keys that leak into free-form message strings.
      if (inputArgs.length > 0) {
        const last = inputArgs[inputArgs.length - 1];
        if (typeof last === "string") {
          inputArgs[inputArgs.length - 1] = last.replace(
            STELLAR_SECRET_PATTERN,
            "[REDACTED]",
          );
        }
      }
      return method.apply(this, inputArgs);
    },
  },
});

module.exports = logger;

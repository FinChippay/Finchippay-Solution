/**
 * src/utils/correlationId.js
 * AsyncLocalStorage-based correlation ID for distributed tracing.
 *
 * Usage:
 *   const { correlationMiddleware, getRequestId } = require("./utils/correlationId");
 *   app.use(correlationMiddleware);  // mount first — before pino-http
 *
 *   // Anywhere in the async call chain:
 *   const requestId = getRequestId();  // returns the current requestId or undefined
 */

"use strict";

const crypto = require("crypto");
const { AsyncLocalStorage } = require("async_hooks");

const als = new AsyncLocalStorage();

/**
 * Express middleware that generates or adopts a correlation ID:
 *  - Uses `X-Request-ID` request header if present
 *  - Otherwise generates a UUID v4
 *  - Sets `X-Request-ID` response header
 *  - Stores the ID in AsyncLocalStorage for downstream propagation
 *  - Sets `req.id` so pino-http picks it up as the log-gen ID
 */
function correlationMiddleware(req, res, next) {
  const requestId = req.headers["x-request-id"] || crypto.randomUUID();
  req.id = requestId;
  res.setHeader("X-Request-ID", requestId);
  als.run({ requestId }, next);
}

/**
 * Retrieve the current request's correlation ID from AsyncLocalStorage.
 * Returns `undefined` when called outside of an active request context
 * (e.g. startup code, background cron-like processes).
 */
function getRequestId() {
  const store = als.getStore();
  return store?.requestId;
}

/**
 * Return an object suitable for spreading into outbound request headers.
 *
 * @returns {{ "X-Request-ID"?: string }}  Empty object when no context.
 */
function getRequestIdHeader() {
  const id = getRequestId();
  return id ? { "X-Request-ID": id } : {};
}

module.exports = {
  correlationMiddleware,
  getRequestId,
  getRequestIdHeader,
};

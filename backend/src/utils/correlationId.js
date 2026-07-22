/**
 * src/utils/correlationId.js
 * AsyncLocalStorage-based correlation ID for distributed tracing.
 *
 * The Express middleware lives in `middleware/requestId.js`. This module
 * exposes helpers for reading the active request context anywhere in the
 * async call chain (services, axios interceptors, webhooks).
 *
 * Usage:
 *   const { getRequestId, getRequestIdHeader } = require("./utils/correlationId");
 *   const requestId = getRequestId();
 *   fetch(url, { headers: { ...getRequestIdHeader() } });
 */

"use strict";

const { AsyncLocalStorage } = require("async_hooks");

const als = new AsyncLocalStorage();

/**
 * Run `fn` inside a request correlation context.
 * Used by `middleware/requestId.js`.
 *
 * @param {{ requestId: string, sessionId?: string }} context
 * @param {() => void} fn
 */
function runWithRequestContext(context, fn) {
  return als.run(context, fn);
}

/**
 * Retrieve the current request's correlation ID from AsyncLocalStorage.
 * Returns `undefined` when called outside of an active request context
 * (e.g. startup code, background jobs).
 */
function getRequestId() {
  const store = als.getStore();
  return store?.requestId;
}

/**
 * Retrieve the frontend session ID when present.
 */
function getSessionId() {
  const store = als.getStore();
  return store?.sessionId;
}

/**
 * Return an object suitable for spreading into outbound request headers.
 *
 * @returns {{ "X-Request-ID"?: string, "X-Session-ID"?: string }}
 */
function getRequestIdHeader() {
  const requestId = getRequestId();
  const sessionId = getSessionId();
  const headers = {};
  if (requestId) headers["X-Request-ID"] = requestId;
  if (sessionId) headers["X-Session-ID"] = sessionId;
  return headers;
}

module.exports = {
  runWithRequestContext,
  getRequestId,
  getSessionId,
  getRequestIdHeader,
};

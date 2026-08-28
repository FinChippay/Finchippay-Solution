/**
 * src/middleware/requestId.js
 * Request ID middleware — generates/adopts X-Request-ID, attaches a
 * request-scoped Pino child logger, and stores context in AsyncLocalStorage.
 *
 * Also adopts optional X-Session-ID from the frontend for session-level traces.
 */

"use strict";

const crypto = require("crypto");
const Sentry = require("@sentry/node");
const logger = require("../utils/logger");
const { runWithRequestContext } = require("../utils/correlationId");
const VALID_REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;

/**
 * Express middleware:
 *  - Reuses inbound `X-Request-ID` when present; otherwise generates UUID v4
 *  - Sets `X-Request-ID` (and `X-Session-ID` when provided) on the response
 *  - Attaches `req.id` and `req.log` (child logger with requestId)
 *  - Runs the rest of the request inside AsyncLocalStorage so services can
 *    call `getRequestId()` without threading the ID through every call site
 *  - Tags the active Sentry scope with `correlationId`
 */
function requestIdMiddleware(req, res, next) {
  const incoming = req.headers["x-request-id"] || req.headers["x-correlation-id"];
  const requestId =
    typeof incoming === "string" && VALID_REQUEST_ID.test(incoming.trim())
      ? incoming.trim()
      : crypto.randomUUID();

  const sessionHeader = req.headers["x-session-id"];
  const sessionId =
    typeof sessionHeader === "string" && sessionHeader.trim() ? sessionHeader.trim() : undefined;

  req.id = requestId;
  if (sessionId) {
    req.sessionId = sessionId;
  }

  res.setHeader("X-Request-ID", requestId);
  res.setHeader("X-Correlation-ID", requestId);
  if (sessionId) {
    res.setHeader("X-Session-ID", sessionId);
  }

  const bindings = { requestId };
  if (sessionId) {
    bindings.sessionId = sessionId;
  }
  req.log = logger.child(bindings);

  runWithRequestContext({ requestId, sessionId }, () => {
    try {
      const scope = Sentry.getCurrentScope();
      scope.setTag("correlationId", requestId);
      scope.setContext("correlation", bindings);
    } catch {
      // Sentry may be disabled / unavailable in some environments
    }
    next();
  });
}

module.exports = { requestIdMiddleware };

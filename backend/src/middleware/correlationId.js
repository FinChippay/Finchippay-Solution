"use strict";

const { randomUUID } = require("crypto");
const { AsyncLocalStorage } = require("async_hooks");
const { trace } = require("@opentelemetry/api");
const logger = require("../utils/logger");

const HEADER_NAME = "x-correlation-id";
const RESPONSE_HEADER_NAME = "X-Correlation-ID";
const VALID_ID_PATTERN = /^[A-Za-z0-9-]{1,128}$/;

const correlationAls = new AsyncLocalStorage();

function correlationIdMiddleware(req, res, next) {
  const incoming = req.headers[HEADER_NAME];
  const correlationId =
    typeof incoming === "string" && VALID_ID_PATTERN.test(incoming) ? incoming : randomUUID();

  req.correlationId = correlationId;
  req.log = logger.child({ correlationId });

  const span = trace.getActiveSpan();
  if (span) {
    span.setAttribute("correlation.id", correlationId);
  }

  res.setHeader(RESPONSE_HEADER_NAME, correlationId);

  correlationAls.run({ correlationId }, next);
}

function getCorrelationId() {
  return correlationAls.getStore()?.correlationId;
}

module.exports = correlationIdMiddleware;
module.exports.getCorrelationId = getCorrelationId;

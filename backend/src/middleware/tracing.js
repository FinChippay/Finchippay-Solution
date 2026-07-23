"use strict";

const { trace, context, propagation } = require("@opentelemetry/api");

/**
 * Express middleware to propagate trace context.
 * - Extracts parent context from incoming traceparent headers (fallback/assurance).
 * - Appends the traceparent header to the response so the client/frontend can continue the trace.
 */
module.exports = function traceContextMiddleware(req, res, next) {
  const activeContext = propagation.extract(context.active(), req.headers);

  context.with(activeContext, () => {
    const span = trace.getSpan(context.active());
    if (span) {
      const spanContext = span.spanContext();
      if (
        spanContext &&
        spanContext.traceId &&
        spanContext.traceId !== "00000000000000000000000000000000"
      ) {
        const traceFlags = spanContext.traceFlags.toString(16).padStart(2, "0");
        const traceparent = `00-${spanContext.traceId}-${spanContext.spanId}-${traceFlags}`;
        res.setHeader("traceparent", traceparent);
        res.setHeader("Access-Control-Expose-Headers", "traceparent");
      }
    }
    next();
  });
};

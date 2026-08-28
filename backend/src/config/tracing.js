/**
 * src/config/tracing.js
 * OpenTelemetry distributed tracing for Finchippay Solution backend.
 *
 * Initialises auto-instrumentation for Express and outbound HTTP calls
 * when OTEL_EXPORTER_OTLP_ENDPOINT is set.  Traces are exported to an
 * OTLP-compatible collector (e.g. Jaeger, Grafana Tempo, Honeycomb).
 *
 * In the "test" environment (NODE_ENV=test) instrumentation is skipped
 * entirely so existing unit tests run without OTel overhead.
 *
 * Usage (server.js - must be the very first require):
 *   require("./config/tracing");  // before dotenv, express, etc.
 *
 * Env vars:
 *   OTEL_EXPORTER_OTLP_ENDPOINT  - OTLP collector base URL (e.g. http://jaeger:4318)
 *   OTEL_SERVICE_NAME            - defaults to "finchippay-backend"
 *   NODE_ENV                     - skipped when "test"
 */

"use strict";

const { NodeSDK } = require("@opentelemetry/sdk-node");
const { getNodeAutoInstrumentations } = require("@opentelemetry/auto-instrumentations-node");
const { OTLPTraceExporter } = require("@opentelemetry/exporter-trace-otlp-http");
const { diag, DiagConsoleLogger, DiagLogLevel, trace } = require("@opentelemetry/api");
const { SamplingDecision } = require("@opentelemetry/sdk-trace-base");
const logger = require("../utils/logger");

// --- Path-based sampling (#802): low sampling for noisy health checks, ---
// full sampling for payment-critical endpoints, default ratio otherwise.
// Declared before the SDK init below, since it's referenced there.
const HEALTH_CHECK_SAMPLE_RATE = parseFloat(process.env.OTEL_SAMPLE_RATE_HEALTH || "0.1");
const DEFAULT_SAMPLE_RATE = parseFloat(process.env.OTEL_SAMPLE_RATE_DEFAULT || "0.5");
const PAYMENT_PATH_PATTERN = /\/api\/(payments|scheduled-transactions|sep24|sep38)/;
const HEALTH_PATH_PATTERN = /\/(health|metrics)/;

class PathBasedSampler {
  shouldSample(context, traceId, spanName, spanKind, attributes) {
    const target = attributes["http.target"] || attributes["http.route"] || spanName || "";
    let rate = DEFAULT_SAMPLE_RATE;
    if (PAYMENT_PATH_PATTERN.test(target)) {
      rate = 1.0;
    } else if (HEALTH_PATH_PATTERN.test(target)) {
      rate = HEALTH_CHECK_SAMPLE_RATE;
    }
    const sampled = Math.random() < rate;
    return { decision: sampled ? SamplingDecision.RECORD_AND_SAMPLED : SamplingDecision.NOT_RECORD };
  }
  toString() {
    return "PathBasedSampler";
  }
}

// --- Guard: skip in test environment or when no endpoint is configured ---

const OTLP_ENDPOINT = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
const NODE_ENV = process.env.NODE_ENV;
let sdk = null;

if (NODE_ENV === "test") {
  logger.info("OpenTelemetry tracing disabled (NODE_ENV=test)");
} else if (!OTLP_ENDPOINT) {
  logger.info("OpenTelemetry tracing disabled (OTEL_EXPORTER_OTLP_ENDPOINT not set)");
} else {
  // --- OTel internal diagnostics ---
  // Log OTel SDK warnings/errors via pino so they appear in structured logs.
  // Use WARN level to avoid verbose debug output in production.

  diag.setLogger(
    new DiagConsoleLogger(),
    NODE_ENV === "production" ? DiagLogLevel.WARN : DiagLogLevel.INFO,
  );

  // --- SDK initialisation ---

  const traceExporter = new OTLPTraceExporter({
    url: OTLP_ENDPOINT.endsWith("/v1/traces") ? OTLP_ENDPOINT : `${OTLP_ENDPOINT}/v1/traces`,
  });

  sdk = new NodeSDK({
    serviceName: process.env.OTEL_SERVICE_NAME || "finchippay-backend",
    traceExporter,
    sampler: new PathBasedSampler(),
    instrumentations: [
      getNodeAutoInstrumentations({
        "@opentelemetry/instrumentation-http": {
          enabled: true,
        },
        "@opentelemetry/instrumentation-express": {
          enabled: true,
        },
        "@opentelemetry/instrumentation-fs": {
          enabled: false, // noisy
        },
        "@opentelemetry/instrumentation-dns": {
          enabled: false, // noisy
        },
        "@opentelemetry/instrumentation-net": {
          enabled: false, // noisy
        },
      }),
    ],
  });

  try {
    sdk.start();
    logger.info(
      { endpoint: OTLP_ENDPOINT },
      "OpenTelemetry tracing enabled - exporting to OTLP collector",
    );
  } catch (err) {
    logger.error(
      { err, endpoint: OTLP_ENDPOINT },
      "Failed to start OpenTelemetry SDK; tracing disabled",
    );
    sdk = null;
  }
}

function getTracer(name) {
  return trace.getTracer(name || "finchippay-backend");
}

module.exports = { sdk, getTracer };

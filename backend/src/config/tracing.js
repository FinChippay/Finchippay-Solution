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
 * Usage (server.js — must be the very first require):
 *   require("./config/tracing");  // before dotenv, express, etc.
 *
 * Env vars:
 *   OTEL_EXPORTER_OTLP_ENDPOINT  – OTLP collector base URL (e.g. http://jaeger:4318)
 *   OTEL_SERVICE_NAME            – defaults to "finchippay-backend"
 *   NODE_ENV                     – skipped when "test"
 */

"use strict";

const { NodeSDK } = require("@opentelemetry/sdk-node");
const {
  getNodeAutoInstrumentations,
} = require("@opentelemetry/auto-instrumentations-node");
const { OTLPTraceExporter } = require("@opentelemetry/exporter-trace-otlp-http");
const { diag, DiagConsoleLogger, DiagLogLevel, trace } = require("@opentelemetry/api");
const logger = require("../utils/logger");

// ─── Guard: skip in test environment or when no endpoint is configured ────────

const OTLP_ENDPOINT = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
const NODE_ENV = process.env.NODE_ENV;
let sdk = null;

if (NODE_ENV === "test") {
  logger.info("OpenTelemetry tracing disabled (NODE_ENV=test)");
} else if (!OTLP_ENDPOINT) {
  logger.info(
    "OpenTelemetry tracing disabled (OTEL_EXPORTER_OTLP_ENDPOINT not set)",
  );
} else {
  // ─── OTel internal diagnostics ───────────────────────────────────────────
  // Log OTel SDK warnings/errors via pino so they appear in structured logs.
  // Use WARN level to avoid verbose debug output in production.

  diag.setLogger(
    new DiagConsoleLogger(),
    NODE_ENV === "production" ? DiagLogLevel.WARN : DiagLogLevel.INFO,
  );

  // ─── SDK initialisation ──────────────────────────────────────────────────

  const traceExporter = new OTLPTraceExporter({
    url: OTLP_ENDPOINT.endsWith("/v1/traces") ? OTLP_ENDPOINT : `${OTLP_ENDPOINT}/v1/traces`,
  });

  sdk = new NodeSDK({
    serviceName: process.env.OTEL_SERVICE_NAME || "finchippay-backend",
    traceExporter,
    instrumentations: [
      getNodeAutoInstrumentations({
        // We add custom spans for Horizon calls in stellarService.js;
        // the auto-instrumentation covers Express (HTTP server) and
        // outbound HTTP/fetch calls to third-party services.
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
      "OpenTelemetry tracing enabled — exporting to OTLP collector",
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

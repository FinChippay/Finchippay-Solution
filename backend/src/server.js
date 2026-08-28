/**
 * src/server.js
 * Express server entry point for Finchippay Solution backend.
 */

"use strict";

// ─── Environment ─────────────────────────────────────────────────────────────
// dotenv must load before the tracing module so OTEL_EXPORTER_OTLP_ENDPOINT
// set in .env is visible when the OpenTelemetry SDK initialises.
require("dotenv").config();

// Docker secrets (JWT_SECRET_FILE, DATABASE_URL_FILE, etc.) must be resolved
// into plain env vars before any other module reads them.
require("./config/dockerSecrets");

// ─── OpenTelemetry tracing (must load before Express/HTTP imports) ────────────
// Auto-instrumentation hooks into Node's module loader via require-in-the-middle,
// so this must be required before express, http, etc. are imported.
const { sdk: otelSdk } = require("./config/tracing");

// Must load before any route requiring axios so the global interceptor
// can forward the correlation ID on every outbound HTTP call.
require("./config/axiosInterceptors");
require("./config/fetchInterceptor");

const express = require("express");
const cors = require("cors");
const pinoHttp = require("pino-http");
const { strictLimiter, createInstrumentedLimiter } = require("./middleware/rateLimit");
const Sentry = require("@sentry/node");
const { formatErrorResponse, ERROR_CODES } = require("../../shared/errorCodes");

const accountRoutes = require("./routes/accounts");
const authRoutes = require("./routes/auth");
const paymentRoutes = require("./routes/payments");
const receiptsRoutes = require("./routes/receipts");
const analyticsRoutes = require("./routes/analytics");
const healthRoutes = require("./routes/health");
const federationRoutes = require("./routes/federation");
const turretsRoutes = require("./routes/turrets");
const tipsRoutes = require("./routes/tips");
const webhookRoutes = require("./routes/webhooks");
const { restoreWebhooks } = require("./services/webhookService");
const inboundWebhookSecretService = require("./services/inboundWebhookSecretService");
const parsePaymentRoutes = require("./routes/parsePayment");
const scheduledTransactionRoutes = require("./routes/scheduledTransactions");
const sep24Routes = require("./routes/sep24");
const sep12Routes = require("./routes/sep12");
const sep38Routes = require("./routes/sep38");
const eventRoutes = require("./routes/events");
const notificationRoutes = require("./routes/notifications");
const featuresRoutes = require("./routes/features");
const adminFeatureFlagsRoutes = require("./routes/adminFeatureFlags");
const tokensRoutes = require("./routes/tokens");
const pushRoutes = require("./routes/push");
const emailRoutes = require("./routes/emails");
const swaggerUi = require("swagger-ui-express");
const swaggerSpec = require("./swagger");
const { startTurretsServer } = require("./turretsServer");
const eventIndexer = require("./services/eventIndexer");
const {
  startRetryWorker,
  closeAllStreams: closeWebhookStreams,
} = require("./services/webhookService");
const logger = require("./utils/logger");
const { validateEnv, parseAllowedOrigins } = require("./config/validateEnv");
const { requireJsonContentType } = require("./middleware/bodyParsing");
const { trackHttpMetrics } = require("./middleware/metrics");
const metricsRoutes = require("./routes/metrics");
const { getRequestId } = require("./utils/correlationId");
const { errorLogFields } = require("./utils/errorResponse");
const { initRedis, closeRedis } = require("./services/cacheService");
const shutdownState = require("./services/shutdownState");
const { closeAll: closeBalanceStreams } = require("./services/balanceStreamService");
const { zodErrorHandler } = require("./validation/middleware");
// Requiring errorResponse registers getRequestId as the shared registry's
// correlation-ID provider (#270).
require("./utils/errorResponse");
const { requestIdMiddleware } = require("./middleware/requestId");
const traceContextMiddleware = require("./middleware/tracing");
const crypto = require("crypto");

const { mountGraphQL } = require("./graphql");

const app = express();
const PORT = process.env.PORT || 4000;

// ─── Error message sanitization (#206) ───────────────────────────────────────
// Stellar secret keys: 'S' + 55 base32 chars [A-Z2-7]. Strip before logging or
// sending to Sentry/clients so a mis-routed key never appears in outputs.

const STELLAR_SECRET_PATTERN = /S[A-Z2-7]{55}/g;
function sanitizeMessage(msg) {
  return typeof msg === "string" ? msg.replace(STELLAR_SECRET_PATTERN, "[REDACTED]") : msg;
}

// ─── Sentry ───────────────────────────────────────────────────────────────────

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV || "development",
  // Only enable in production unless SENTRY_DSN is explicitly set
  enabled: !!process.env.SENTRY_DSN,
  tracesSampleRate: 0.2,
  // #206: strip Stellar secret keys from error messages before Sentry receives them
  beforeSend(event) {
    if (event.exception?.values) {
      event.exception.values = event.exception.values.map((v) => ({
        ...v,
        value: sanitizeMessage(v.value),
      }));
    }
    // Attach correlation ID so Sentry events can be cross-referenced with logs.
    const requestId = getRequestId();
    if (requestId) {
      event.tags = { ...event.tags, correlationId: requestId };
      event.extra = { ...event.extra, correlationId: requestId };
    }
    return event;
  },
});

function stripProtocol(value) {
  return String(value || "")
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .trim();
}

function getFederationDomain(req) {
  return stripProtocol(
    process.env.FEDERATION_DOMAIN ||
      process.env.DOMAIN ||
      process.env.HOME_DOMAIN ||
      req.get("host") ||
      "stellarfinchippay.io",
  );
}

function getFederationServerUrl(req) {
  if (process.env.FEDERATION_SERVER_URL) {
    return process.env.FEDERATION_SERVER_URL;
  }

  const domain = getFederationDomain(req);
  const protocol =
    process.env.FEDERATION_SERVER_PROTOCOL ||
    (domain.startsWith("localhost") || domain.startsWith("127.0.0.1") ? "http" : "https");

  return `${protocol}://${domain}/federation`;
}

// ─── Middleware ───────────────────────────────────────────────────────────────

/**
 * Content-Security-Policy directives for this JSON API.
 *
 * The backend serves no HTML pages of its own except Swagger UI at /api/docs,
 * so the policy is intentionally restrictive.
 */
// Helmet and rate-limit are configured via securityHeaders + createInstrumentedLimiter
const securityHeaders = require("./middleware/securityHeaders");
const corsConfig = require("./middleware/corsConfig");

app.use(securityHeaders);
app.use(corsConfig);
// Prometheus HTTP metrics — track duration & count for every request.
app.use(trackHttpMetrics);
// Request ID middleware (#172) — generates/adopts X-Request-ID, attaches
// req.log child logger, stores context in ALS, tags Sentry.
// Mounted before pino-http so the requestId appears in every log line.
app.use(requestIdMiddleware);
app.use(traceContextMiddleware);
// Structured JSON request logging (#269) — replaces morgan('dev'); reuses the
// shared pino logger so HTTP logs are machine-parseable (Datadog/CloudWatch).
app.use(
  pinoHttp({
    logger,
    genReqId: (req) => req.id || crypto.randomUUID(),
  }),
);

// Content-Type enforcement (#81)
app.use(requireJsonContentType);

// JSON body size limits (#81, #353) — configurable via env vars.
// Apply standard body parsing with env-configured limits.
const { bodyParsing } = require("./middleware/bodyParsing");
bodyParsing(app);
// /api/turrets gets a larger limit for txFunction payloads.
app.use("/api/turrets", express.json({ limit: "512kb" }));

// JSON body parsing error handler — uses standardized error codes
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
    return res
      .status(ERROR_CODES.VAL_INVALID_JSON.httpStatus)
      .json(formatErrorResponse("VAL_INVALID_JSON"));
  }
  if (err.type === "entity.too.large" || err.status === 413) {
    return res
      .status(ERROR_CODES.VAL_BODY_TOO_LARGE.httpStatus)
      .json(formatErrorResponse("VAL_BODY_TOO_LARGE"));
  }
  next();
});

// CORS
const { origins: allowedOrigins } = parseAllowedOrigins(process.env.ALLOWED_ORIGINS);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`CORS: origin ${origin} not allowed`));
      }
    },
    methods: ["GET", "POST", "DELETE"],
    // X-Request-ID / X-Session-ID: correlation headers for structured logging (#50).
    // traceparent / tracestate: W3C Trace Context from frontend OpenTelemetry.
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Request-ID",
      "X-Correlation-ID",
      "X-Session-ID",
      "traceparent",
      "tracestate",
    ],
    exposedHeaders: ["X-Request-ID", "X-Correlation-ID", "X-Session-ID"],
    credentials: true,
  }),
);

app.use("/health", healthRoutes);
app.use("/api/health", healthRoutes);

// Stellar SEP-0001 discovery document
app.get("/.well-known/stellar.toml", (req, res) => {
  const domain = getFederationDomain(req);
  const protocol =
    req.get("x-forwarded-proto") ||
    (domain.startsWith("localhost") || domain.startsWith("127.0.0.1") ? "http" : "https");
  const serverUrl = getFederationServerUrl(req);
  const transferServerUrl = process.env.TRANSFER_SERVER_URL || `${protocol}://${domain}`;

  const tomlContent = `# Finchippay Solution federation discovery
FEDERATION_SERVER="${serverUrl}"
TRANSFER_SERVER_SEP0024="${transferServerUrl}"
`;

  res.setHeader("Content-Type", "application/toml; charset=utf-8");
  res.send(tomlContent);
});

// Global rate limiting — 100 requests per 15 minutes per IP.
const limiter = createInstrumentedLimiter(
  {
    windowMs: 15 * 60 * 1000,
    limit: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: formatErrorResponse("RATE_LIMITED_GLOBAL"),
  },
  "global",
);
app.use(limiter);

const paginationMiddleware = require("./middleware/pagination");
app.use(paginationMiddleware);

// ─── Routes ──────────────────────────────────────────────────────────────────
// Versioned API (v1) plus legacy /api/* aliases with Deprecation header (#83).

const apiRouteMounts = [
  { path: "/auth", router: authRoutes },
  { path: "/accounts", router: accountRoutes },
  { path: "/payments", router: paymentRoutes },
  { path: "/webhooks", router: webhookRoutes },
  { path: "/analytics", router: analyticsRoutes },
  { path: "/turrets", router: turretsRoutes },
  { path: "/tips", router: tipsRoutes },
  { path: "/events", router: eventRoutes },
  { path: "/scheduled", router: scheduledTransactionRoutes },
  { path: "/scheduled-transactions", router: scheduledTransactionRoutes },
  { path: "/parse-payment", router: parsePaymentRoutes },
  { path: "/scheduled-txns", router: scheduledTransactionRoutes },
  { path: "/sep24", router: sep24Routes },
  { path: "/sep38", router: sep38Routes },
];

for (const { path, router } of apiRouteMounts) {
  app.use(`/api/v1${path}`, router);
}

app.use("/api/auth", authRoutes);
app.use("/api/accounts", accountRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/receipts", receiptsRoutes);
app.use("/api/webhooks", webhookRoutes);
app.use("/api/analytics", analyticsRoutes);
app.use("/api/turrets", turretsRoutes);
app.use("/api/tips", tipsRoutes);
app.use("/api/parse-payment", strictLimiter, parsePaymentRoutes);
app.use("/api/scheduled", scheduledTransactionRoutes);
app.use("/api/scheduled-transactions", scheduledTransactionRoutes);
app.use("/api/events", eventRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/sep24", sep24Routes);
app.use("/api/sep12", sep12Routes);
app.use("/api/sep38", sep38Routes);
app.use("/sep38", sep38Routes);
app.use("/api/push", pushRoutes);
app.use("/api/emails", emailRoutes);
app.use("/api/features", featuresRoutes);
app.use("/api/admin/feature-flags", adminFeatureFlagsRoutes);
app.use("/api/v1/tokens", tokensRoutes);
app.use("/federation", federationRoutes);
app.use("/metrics", metricsRoutes);

// ─── GraphQL ───────────────────────────────────────────────────────────────────
// Mounted at module scope (not inside the require.main guard below) so the
// endpoint exists on the exported `app` for both production startup and
// tests that `require("../src/server")` directly.
mountGraphQL(app);

// ─── API Documentation ─────────────────────────────────────────────────────────

app.use(
  "/api/docs",
  swaggerUi.serve,
  swaggerUi.setup(swaggerSpec, {
    customSiteTitle: "Finchippay Solution API Docs",
    customCss: ".swagger-ui .topbar { display: none }",
    swaggerOptions: { url: "/api/docs.json" },
  }),
);

app.get("/api/docs.json", (req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.send(swaggerSpec);
});

// ─── 404 Handler ───────────────────────────────────────────────────────────────

app.use((req, res) => {
  const sanitizedPath = req.path.replace(/[\r\n]/g, "");
  const log = req.log || logger;
  log.warn({ method: req.method, path: sanitizedPath }, "Route not found");
  res
    .status(ERROR_CODES.RES_ROUTE_NOT_FOUND.httpStatus)
    .json(formatErrorResponse("RES_ROUTE_NOT_FOUND"));
});

// ─── Error Handling ────────────────────────────────────────────────────────────

Sentry.setupExpressErrorHandler(app);

// Convert any stray ZodError (thrown outside the validate() middleware) into
// the standard 400 payload.
app.use(zodErrorHandler);

app.use((err, req, res, next) => {
  void next;
  const log = req.log || logger;
  if (err.errorCode) {
    const entry = formatErrorResponse(err.errorCode, err.details);
    const status = err.status || ERROR_CODES[err.errorCode]?.httpStatus || 500;
    log.error(
      { ...errorLogFields(err.errorCode, { details: err.details }), status },
      "Request error",
    );
    return res.status(status).json(entry);
  }

  const status = err.status || 500;
  const message = sanitizeMessage(err.message) || ERROR_CODES.SRV_INTERNAL.message;
  log.error({ ...errorLogFields("SRV_INTERNAL"), status, message }, "Request error");
  const fallback = formatErrorResponse("SRV_INTERNAL", {
    originalMessage: sanitizeMessage(err.message),
  });
  res.status(status).json(fallback);
});

// ─── Graceful shutdown ────────────────────────────────────────────────

// How long to wait after readiness starts failing before tearing down
// background workers and exiting — gives Kubernetes time to observe the
// failed readiness probe and stop routing new traffic (readinessProbe
// periodSeconds: 10 in kubernetes/backend/deployment.yaml).
const SHUTDOWN_DRAIN_MS = parseInt(process.env.SHUTDOWN_DRAIN_MS, 10) || 10_000;

async function gracefulShutdown(signal, server, otelSdk) {
  logger.info({ signal }, "Received shutdown signal — draining…");

  // Fail readiness immediately so /api/health/ready starts returning 503
  // before any in-flight work is torn down.
  shutdownState.markShuttingDown();

  server.close((err) => {
    if (err) logger.error({ err }, "Error closing HTTP server");
  });

  // Give Kubernetes time to observe the failed readiness probe and drain
  // in-flight requests before workers are stopped and the process exits.
  await new Promise((resolve) => setTimeout(resolve, SHUTDOWN_DRAIN_MS));

  // 1. Stop scheduled executor
  try {
    require("./services/scheduledExecutor").stop();
  } catch (err) {
    logger.error({ err }, "Error stopping scheduled executor");
  }

  // Close webhook Horizon SSE streams (stops retry worker, waits for deliveries)
  try {
    await closeWebhookStreams();
  } catch (err) {
    logger.error({ err }, "Error closing webhook streams");
  }

  // Close balance SSE streams
  try {
    closeBalanceStreams();
  } catch (err) {
    logger.error({ err }, "Error closing balance streams");
  }

  await closeRedis();

  if (otelSdk) {
    try {
      await Promise.race([
        otelSdk.shutdown(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("OTel shutdown timed out")), 5_000),
        ),
      ]);
      logger.info("OpenTelemetry SDK shut down");
    } catch (err) {
      logger.error({ err }, "Error shutting down OpenTelemetry SDK");
    }
  }

  process.exit(0);
}

// ─── Start ────────────────────────────────────────────────────────────────────

if (require.main === module) {
  (async () => {
    validateEnv();

    if (process.env.NODE_ENV === "development") {
      try {
        const [batchNo, migrated] = await require("./db").migrate.latest();
        if (migrated.length > 0) {
          logger.info(
            { batch: batchNo, migrations: migrated },
            "Applied pending database migrations",
          );
        }
      } catch (err) {
        logger.error({ err }, "Auto-migration failed; aborting startup");
        process.exit(1);
      }
    }

    initRedis().catch((err) => {
      logger.error({ err }, "Redis initialisation failed");
    });
    require("./services/scheduledTransactionService")
      .loadActiveSchedules()
      .catch((err) => {
        logger.error({ err }, "Failed to load active scheduled transactions");
      });
    // Start scheduled transaction executor and data retention cron
    require("./services/scheduledExecutor").start();
    require("./services/dataRetentionService").startRetentionCron();

    const server = app.listen(PORT, async () => {
      logger.info(
        { port: PORT, network: process.env.STELLAR_NETWORK || "testnet" },
        "Finchippay Solution API server started",
      );
      logger.info(`
 ✨ Finchippay Solution API
 🚀 Server running at http://localhost:${PORT}
 🌐 Network: ${process.env.STELLAR_NETWORK || "testnet"}
 `);
      // Reload persisted webhook registrations and re-establish Horizon SSE
      // streams. Must run after the server is bound so the port is guaranteed
      // ready before any incoming payment events trigger deliveries.
      await restoreWebhooks();
      // First boot only: provision a secret for the SEP-24 anchor callback
      // if one doesn't already exist, so the endpoint is verifiable without
      // a separate manual setup step. Printed once — never persisted to
      // logs again — so an operator can capture it and configure it on the
      // anchor's side. Use inboundWebhookSecretService.rotateSecret() to
      // change it afterwards.
      const newSep24Secret = await inboundWebhookSecretService.ensureSecretExists(
        "sep24_callback",
      );
      if (newSep24Secret) {
        logger.warn(
          { endpoint: "sep24_callback", secretId: newSep24Secret.id },
          `Generated a new sep24_callback webhook secret — configure this on the anchor's side, it will not be shown again: ${newSep24Secret.secret}`,
        );
      }
      startTurretsServer();
      eventIndexer.start();
      startRetryWorker();
    });

    process.on("SIGTERM", () => {
      eventIndexer.stop();
      gracefulShutdown("SIGTERM", server, otelSdk);
    });
    process.on("SIGINT", () => {
      eventIndexer.stop();
      gracefulShutdown("SIGINT", server, otelSdk);
    });
  })();
}

module.exports = app;

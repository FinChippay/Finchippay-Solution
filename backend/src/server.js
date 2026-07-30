/**
 * src/server.js
 * Express server entry point for Finchippay Solution backend.
 */

"use strict";
const crypto = require("crypto");

// ─── Environment ─────────────────────────────────────────────────────────────
// dotenv must load before the tracing module so OTEL_EXPORTER_OTLP_ENDPOINT
// set in .env is visible when the OpenTelemetry SDK initialises.
require("dotenv").config();

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
const helmet = require("helmet");
const requestLogger = require("./middleware/requestLogger");
const rateLimit = require("express-rate-limit");
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
const swaggerUi = require("swagger-ui-express");
const swaggerSpec = require("./swagger");
const { startTurretsServer } = require("./turretsServer");
const eventIndexer = require("./services/eventIndexer");
const {
  startRetryWorker,
  closeAllStreams: closeWebhookStreams,
} = require("./services/webhookSubscriptionService");
const {
  startCleanupWorker,
  stopCleanupWorker,
} = require("./services/eventCleanupService");
const logger = require("./utils/logger");
const { validateEnv, parseAllowedOrigins } = require("./config/validateEnv");
const { requireJsonContentType } = require("./middleware/bodyParsing");
const { trackHttpMetrics } = require("./middleware/metrics");
const metricsRoutes = require("./routes/metrics");
const {
  correlationMiddleware,
  getRequestId,
} = require("./utils/correlationId");
const { errorLogFields } = require("./utils/errorResponse");
const { initRedis, closeRedis } = require("./services/cacheService");
const {
  closeAll: closeBalanceStreams,
} = require("./services/balanceStreamService");
const { zodErrorHandler } = require("./validation/middleware");
const traceContextMiddleware = require("./middleware/tracing");
const correlationIdMiddleware = require("./middleware/correlationId");
const { setCorrelationIdProvider } = require("../../shared/errorCodes");
setCorrelationIdProvider(correlationIdMiddleware.getCorrelationId);

const app = express();
const PORT = process.env.PORT || 4000;

// ─── Error message sanitization (#206) ───────────────────────────────────────
// Stellar secret keys: 'S' + 55 base32 chars [A-Z2-7]. Strip before logging or
// sending to Sentry/clients so a mis-routed key never appears in outputs.

const STELLAR_SECRET_PATTERN = /S[A-Z2-7]{55}/g;
function sanitizeMessage(msg) {
  return typeof msg === "string"
    ? msg.replace(STELLAR_SECRET_PATTERN, "[REDACTED]")
    : msg;
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
    (domain.startsWith("localhost") || domain.startsWith("127.0.0.1")
      ? "http"
      : "https");

  return `${protocol}://${domain}/federation`;
}

// ─── Middleware ───────────────────────────────────────────────────────────────

/**
 * Content-Security-Policy directives for this JSON API.
 *
 * The backend serves no HTML pages of its own except Swagger UI at /api/docs,
 * so the policy is intentionally restrictive.
 */
const helmetOptions = {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameSrc: ["'none'"],
    },
  },
};

app.use(helmet(helmetOptions));
// Prometheus HTTP metrics — track duration & count for every request.
app.use(trackHttpMetrics);
// Correlation ID middleware — generates/adopts X-Request-ID, stores in ALS.
app.use(correlationMiddleware);
app.use(traceContextMiddleware);
app.use(correlationIdMiddleware);
// Structured JSON request logging
app.use(requestLogger);

// Content-Type enforcement (#81)
app.use(requireJsonContentType);

// JSON body size limits (#81, #353) — configurable via env vars.
// Apply standard body parsing with env-configured limits.
const { bodyParsing } = require("./middleware/bodyParsing");
bodyParsing(app);
// /api/turrets gets a larger limit for txFunction payloads.
app.use("/api/turrets", express.json({ limit: "512kb" }));

app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
    return res.status(400).json({ error: "Invalid JSON body" });
  }
  if (err.type === "entity.too.large" || err.status === 413) {
    const limit = err.limit || "unknown";
    return res.status(413).json({
      error: "PAYLOAD_TOO_LARGE",
      message: `Request body exceeds the ${limit} limit.`,
    });
  }
  next();
});

// CORS
const { origins: allowedOrigins } = parseAllowedOrigins(
  process.env.ALLOWED_ORIGINS,
);

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
    // traceparent/tracestate: W3C Trace Context headers the frontend's
    // OpenTelemetry instrumentation attaches to every fetch() call.
    allowedHeaders: ["Content-Type", "Authorization", "traceparent", "tracestate"],
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
    (domain.startsWith("localhost") || domain.startsWith("127.0.0.1")
      ? "http"
      : "https");
  const serverUrl = getFederationServerUrl(req);
  const transferServerUrl =
    process.env.TRANSFER_SERVER_URL || `${protocol}://${domain}`;

  const tomlContent = `# Finchippay Solution federation discovery
FEDERATION_SERVER="${serverUrl}"
TRANSFER_SERVER_SEP0024="${transferServerUrl}"
`;

  res.setHeader("Content-Type", "application/toml; charset=utf-8");
  res.send(tomlContent);
});

// Global rate limiting — 100 requests per 15 minutes per IP.
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: formatErrorResponse("RATE_LIMITED_GLOBAL"),
});
app.use(limiter);

// Sensitive rate limiting — 10 requests per minute per IP.
// Applied to endpoints that call external APIs (e.g. Anthropic Claude)
// to prevent budget exhaustion from abusive clients.
const sensitiveLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: formatErrorResponse("RATE_LIMITED_SENSITIVE"),
});

// ─── Routes ──────────────────────────────────────────────────────────

app.use("/api/auth", authRoutes);
app.use("/api/accounts", accountRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/receipts", receiptsRoutes);
app.use("/api/webhooks", webhookRoutes);
app.use("/api/analytics", analyticsRoutes);
app.use("/api/turrets", turretsRoutes);
app.use("/api/tips", tipsRoutes);
app.use("/api/parse-payment", sensitiveLimiter, parsePaymentRoutes);
app.use("/api/scheduled-transactions", scheduledTransactionRoutes);
app.use("/api/events", eventRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/sep24", sep24Routes);
app.use("/api/sep12", sep12Routes);
app.use("/sep38", sep38Routes);
app.use("/api/push", pushRoutes);
app.use("/api/features", featuresRoutes);
app.use("/api/admin/feature-flags", adminFeatureFlagsRoutes);
app.use("/api/v1/tokens", tokensRoutes);
app.use("/federation", federationRoutes);
app.use("/metrics", metricsRoutes);

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
  logger.warn({ method: req.method, path: sanitizedPath }, "Route not found");
  res
    .status(ERROR_CODES.RES_ROUTE_NOT_FOUND.httpStatus)
    .json(formatErrorResponse("RES_ROUTE_NOT_FOUND"));
});

// ─── Error Handling ────────────────────────────────────────────────────────────

Sentry.setupExpressErrorHandler(app);

// Convert any stray ZodError into the standard 400 payload.
app.use(zodErrorHandler);

app.use((err, req, res, next) => {
  void next;
  if (err.errorCode) {
    const entry = formatErrorResponse(err.errorCode, err.details);
    const status = err.status || ERROR_CODES[err.errorCode]?.httpStatus || 500;
    logger.error(
      { ...errorLogFields(err.errorCode, { details: err.details }), status },
      "Request error",
    );
    return res.status(status).json(entry);
  }

  const status = err.status || 500;
  const message =
    sanitizeMessage(err.message) || ERROR_CODES.SRV_INTERNAL.message;
  logger.error(
    { ...errorLogFields("SRV_INTERNAL"), status, message },
    "Request error",
  );

  const fallback = formatErrorResponse("SRV_INTERNAL", {
    originalMessage: sanitizeMessage(err.message),
  });
  res.status(status).json(fallback);
});

// ─── Graceful shutdown ────────────────────────────────────────────────

async function gracefulShutdown(signal, server, otelSdk) {
  logger.info({ signal }, "Received shutdown signal — draining…");

  server.close((err) => {
    if (err) logger.error({ err }, "Error closing HTTP server");
  });

  // 1. Stop scheduled executor
  try {
    require("./services/scheduledExecutor").stop();
  } catch (err) {
    logger.error({ err }, "Error stopping scheduled executor");
  }

  // 2. Close webhook Horizon SSE streams (stops retry worker, waits for deliveries)
  try {
    await closeWebhookStreams();
  } catch (err) {
    logger.error({ err }, "Error closing webhook streams");
  }

  // 3. Close balance SSE streams
  try {
    closeBalanceStreams();
  } catch (err) {
    logger.error({ err }, "Error closing balance streams");
  }

  // 4. Close Redis connection
  await closeRedis();

  // 5. Flush OTel spans (time-boxed at 5 s)
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

    // Auto-run pending migrations in development so the schema is always
    // current for local work. Other environments migrate explicitly via the
    // deploy pipeline (npm run migrate), not on boot.
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

    // Initialise Redis connection (non-blocking; degrades gracefully if unavailable)
    initRedis().catch((err) => {
      logger.error({ err }, "Redis initialisation failed");
    });
    require("./services/scheduledTransactionService")
      .loadActiveSchedules()
      .catch((err) => {
        logger.error({ err }, "Failed to load active scheduled transactions");
      });
    // Start scheduled transaction executor
    require("./services/scheduledExecutor").start();
    require("./services/dataRetentionService").startRetentionCron();
    const server = app.listen(PORT, () => {
      logger.info(`
 ✨ Finchippay Solution API
 🚀 Server running at http://localhost:${PORT}
 🌐 Network: ${process.env.STELLAR_NETWORK || "testnet"}
 `);
    });

    startTurretsServer();
    eventIndexer.start();
    startRetryWorker();

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

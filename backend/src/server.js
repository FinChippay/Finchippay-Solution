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

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const pinoHttp = require("pino-http");
const rateLimit = require("express-rate-limit");
const Sentry = require("@sentry/node");
const { formatErrorResponse, ERROR_CODES } = require("../../shared/errorCodes");

const accountRoutes = require("./routes/accounts");
const authRoutes = require("./routes/auth");
const paymentRoutes = require("./routes/payments");
const analyticsRoutes = require("./routes/analytics");
const healthRoutes = require("./routes/health");
const federationRoutes = require("./routes/federation");
const turretsRoutes = require("./routes/turrets");
const tipsRoutes = require("./routes/tips");
const webhookRoutes = require("./routes/webhooks");
const parsePaymentRoutes = require("./routes/parsePayment");
const scheduledTransactionRoutes = require("./routes/scheduledTransactions");
const sep24Routes = require("./routes/sep24");
const swaggerUi = require("swagger-ui-express");
const swaggerSpec = require("./swagger");
const { startTurretsServer } = require("./turretsServer");
const logger = require("./utils/logger");
const { validateEnv, parseAllowedOrigins } = require("./config/validateEnv");
const { requireJsonContentType } = require("./middleware/bodyParsing");
const { trackHttpMetrics } = require("./middleware/metrics");
const metricsRoutes = require("./routes/metrics");
const { correlationMiddleware, getRequestId } = require("./utils/correlationId");
const { initRedis, closeRedis } = require("./services/cacheService");

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
 * so the policy is intentionally restrictive:
 *
 *  defaultSrc  – block everything not listed explicitly.
 *  scriptSrc   – only same-origin scripts (Swagger UI bundles its own JS).
 *  styleSrc    – same-origin + unsafe-inline (Swagger UI injects inline styles).
 *  imgSrc      – same-origin + data URIs (Swagger UI logo).
 *  connectSrc  – only same-origin fetch/XHR (all API calls go to self).
 *  fontSrc     – same-origin only.
 *  objectSrc   – none (no Flash / plugins).
 *  frameSrc    – none (not embedded in iframes).
 *  upgradeInsecureRequests – omitted intentionally; handled at the load-balancer
 *                            level in production.
 *
 * Helmet v7+ ships with CSP *disabled* by default, so this must be explicit.
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
// Mounted before routes so the "finish" event captures the resolved
// route pattern (e.g. "GET /api/payments/:id") rather than raw paths.
app.use(trackHttpMetrics);
// Correlation ID middleware — generates/adopts X-Request-ID, stores in ALS.
// Mounted before pino-http so the requestId appears in every log line.
app.use(correlationMiddleware);
// Structured JSON request logging (#269) — replaces morgan('dev'); reuses the
// shared pino logger so HTTP logs are machine-parseable (Datadog/CloudWatch).
// req.id is set by correlationMiddleware above.
app.use(
  pinoHttp({
    logger,
    genReqId: (req) => req.id || crypto.randomUUID(),
    customProps: () => {
      const requestId = getRequestId();
      return requestId ? { requestId } : {};
    },
  }),
);

// Content-Type enforcement (#81) — reject POST/PUT requests whose body isn't
// application/json before the JSON parser below gets a chance to silently
// skip it.
app.use(requireJsonContentType);

// JSON body size limits (#81).
// /api/turrets may receive larger txFunction payloads, so it gets its own
// parser with a higher limit; every other route falls through to the 100kb
// default. body-parser skips re-parsing a request whose body it has already
// parsed (req._body), so mounting the turrets parser first is sufficient —
// the global parser below is a no-op for requests it already handled.
app.use("/api/turrets", express.json({ limit: "512kb" }));
app.use(express.json({ limit: "100kb" }));

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
// parseAllowedOrigins validates format at startup (see validateEnv.js) and
// returns the trimmed list of origins that are safe to use at runtime.
// Any malformed entries cause process.exit(1) before this line is reached.
const { origins: allowedOrigins } = parseAllowedOrigins(
  process.env.ALLOWED_ORIGINS,
);

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (e.g. curl, Postman)
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`CORS: origin ${origin} not allowed`));
      }
    },
    methods: ["GET", "POST", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  }),
);

// ─── Health route (exempt from rate limiting) ─────────────────────────────────

app.use("/health", healthRoutes);
app.use("/api/health", healthRoutes);

// Stellar SEP-0001 discovery document. Wallets and SDKs read this file to
// discover the SEP-0002 federation endpoint for `name*domain` addresses.
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
// standardHeaders: true  → emits RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset (RFC 6585 draft-7).
// legacyHeaders: false   → suppresses deprecated X-RateLimit-* headers.
// Clients should inspect RateLimit-Remaining and back off when it approaches 0.
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: formatErrorResponse("RATE_LIMITED_GLOBAL"),
});
app.use(limiter);

// ─── Routes ──────────────────────────────────────────────────────────────────

app.use("/api/auth", authRoutes);
app.use("/api/accounts", accountRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/webhooks", webhookRoutes);
app.use("/api/analytics", analyticsRoutes);
app.use("/api/turrets", turretsRoutes);
app.use("/api/tips", tipsRoutes);
app.use("/api/parse-payment", parsePaymentRoutes);
app.use("/api/scheduled-txns", scheduledTransactionRoutes);
app.use("/api/sep24", sep24Routes);
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

// Sentry must capture errors before the generic handler responds
Sentry.setupExpressErrorHandler(app);

app.use((err, req, res, next) => {
  void next;
  // If the error already has a code from our registry, use it directly.
  if (err.errorCode) {
    const entry = formatErrorResponse(err.errorCode, err.details);
    const status = err.status || ERROR_CODES[err.errorCode]?.httpStatus || 500;
    logger.error({ status, errorCode: err.errorCode, details: err.details }, "Request error");
    return res.status(status).json(entry);
  }

  const status = err.status || 500;
  const message = sanitizeMessage(err.message) || ERROR_CODES.SRV_INTERNAL.message;
  logger.error({ status, message }, "Request error");
  // For unknown/unclassified errors, fall back to SRV_INTERNAL with raw details.
  const fallback = formatErrorResponse("SRV_INTERNAL", {
    originalMessage: sanitizeMessage(err.message),
  });
  res.status(status).json(fallback);
});

// ─── Graceful shutdown ────────────────────────────────────────────────────────
// On SIGTERM / SIGINT, flush pending OpenTelemetry spans and close the
// HTTP server before exiting so no traces or in-flight requests are lost.

async function gracefulShutdown(signal, server, otelSdk) {
  logger.info({ signal }, "Received shutdown signal — draining…");

  // 1. Stop accepting new connections
  server.close((err) => {
    if (err) logger.error({ err }, "Error closing HTTP server");
  });

  // 2. Close Redis connection
  await closeRedis();

  // 3. Flush OTel spans (time-boxed at 5 s)
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
  validateEnv();
  // Initialise Redis connection (non-blocking; degrades gracefully if unavailable)
  initRedis().catch((err) => {
    logger.error({ err }, "Redis initialisation failed");
  });
  const server = app.listen(PORT, () => {
    console.log(`
  ✨ Finchippay Solution API
  🚀 Server running at http://localhost:${PORT}
  🌐 Network: ${process.env.STELLAR_NETWORK || "testnet"}
  `);
  });

  startTurretsServer();

  process.on("SIGTERM", () => gracefulShutdown("SIGTERM", server, otelSdk));
  process.on("SIGINT", () => gracefulShutdown("SIGINT", server, otelSdk));
}

module.exports = app;

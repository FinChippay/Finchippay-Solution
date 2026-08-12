/**
 * src/turretsServer.js
 * Sidecar Express server for Stellar Turrets txFunctions endpoints.
 *
 * Hardened with the same security posture as the main server:
 *   - Structured JSON logging (pino) instead of morgan
 *   - Rate limiting on tx-functions endpoints
 *   - Restricted CORS (same origins as main server)
 *   - Sentry error tracking
 *   - Correlation ID tracking
 */

"use strict";

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const pinoHttp = require("pino-http");
const rateLimit = require("express-rate-limit");
const Sentry = require("@sentry/node");
const crypto = require("crypto");
const turretsRoutes = require("./routes/turrets");
const { startRunner } = require("./services/turretsService");
const priceFeedService = require("./services/priceFeedService");
const { formatErrorResponse, ERROR_CODES } = require("../../shared/errorCodes");
const logger = require("./utils/logger");
const { correlationMiddleware, getRequestId } = require("./utils/correlationId");
// Registers the correlation-ID provider for error bodies built in this process.
const { errorLogFields } = require("./utils/errorResponse");
const { parseAllowedOrigins } = require("./config/validateEnv");

const TURRETS_PORT = Number(process.env.TURRETS_PORT || 4100);

// ─── Sentry (module-level init, idempotent) ───────────────────────────────────
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV || "development",
  enabled: !!process.env.SENTRY_DSN,
  tracesSampleRate: 0.2,
});

function createTurretsApp() {
  const app = express();

  // ─── Helmet ─────────────────────────────────────────────────────────────────
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'"],
          imgSrc: ["'self'"],
          connectSrc: ["'self'"],
          fontSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameSrc: ["'none'"],
        },
      },
    }),
  );

  // ─── Correlation ID & Structured Logging ────────────────────────────────────
  app.use(correlationMiddleware);
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

  // ─── Body Parsing ───────────────────────────────────────────────────────────
  app.use(express.json({ limit: "100kb" }));

  // ─── CORS (restricted, same as main server) ─────────────────────────────────
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
      methods: ["GET", "POST"],
      allowedHeaders: ["Content-Type", "Authorization"],
      credentials: true,
    }),
  );

  // ─── Rate Limiting ──────────────────────────────────────────────────────────
  // Turrets tx-functions are sensitive — 10 requests per minute per IP.
  const turretsLimiter = rateLimit({
    windowMs: 1 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: formatErrorResponse("RATE_LIMITED_SENSITIVE"),
  });

  // ─── Health (exempt from rate limiting) ─────────────────────────────────────
  app.get("/health", async (req, res, next) => {
    try {
      const priceFeed = await priceFeedService.getPriceFeedStatus();
      const isHealthy = priceFeed.activeProvider !== null;
      res.status(isHealthy ? 200 : 503).json({
        success: isHealthy,
        service: "turrets",
        status: isHealthy ? "ok" : "degraded",
        priceFeed,
      });
    } catch (err) {
      next(err);
    }
  });

  // ─── tx-functions routes (rate-limited) ─────────────────────────────────────
  app.use("/tx-functions", turretsLimiter, turretsRoutes);

  // ─── Sentry error handler (must be before generic handler) ──────────────────
  Sentry.setupExpressErrorHandler(app);

  // ─── Error handler ──────────────────────────────────────────────────────────
  app.use((err, req, res, next) => {
    void next;
    if (err.errorCode) {
      const status = err.status || ERROR_CODES[err.errorCode]?.httpStatus || 500;
      logger.error(
        { ...errorLogFields(err.errorCode, { details: err.details }), status },
        "Request error",
      );
      return res.status(status).json(formatErrorResponse(err.errorCode, err.details));
    }
    const status = err.status || 500;
    logger.error(
      { ...errorLogFields("SRV_INTERNAL"), status, message: err.message },
      "Request error",
    );
    res.status(status).json(
      formatErrorResponse("SRV_INTERNAL", {
        reason: err.message || "Internal Server Error",
      }),
    );
  });

  return app;
}

function startTurretsServer() {
  const app = createTurretsApp();
  startRunner();

  return app.listen(TURRETS_PORT, () => {
    logger.info({ port: TURRETS_PORT }, "Turrets txFunctions server started");
  });
}

module.exports = { createTurretsApp, startTurretsServer };

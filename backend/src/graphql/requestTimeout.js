/**
 * src/graphql/requestTimeout.js
 * Request-timeout guard for the GraphQL endpoint (#630).
 *
 * A resolver that hangs (slow upstream call, pathological query) ties up a
 * server connection indefinitely. This responds with 504 if the request
 * hasn't finished within GRAPHQL_TIMEOUT_MS, freeing the client — it does
 * not abort in-flight resolver work, but it stops the connection (and the
 * client) from waiting forever.
 *
 * Configurable via GRAPHQL_TIMEOUT_MS (default: 15000).
 */

"use strict";

const logger = require("../utils/logger");

const DEFAULT_TIMEOUT_MS = 15_000;

function getTimeoutMs() {
  const parsed = parseInt(process.env.GRAPHQL_TIMEOUT_MS, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
}

function requestTimeoutMiddleware(ms = getTimeoutMs()) {
  return (req, res, next) => {
    const timer = setTimeout(() => {
      if (!res.headersSent) {
        logger.warn({ path: req.originalUrl, timeoutMs: ms }, "GraphQL request timed out");
        res.status(504).json({
          errors: [
            {
              message: "GraphQL request timed out",
              extensions: { code: "REQUEST_TIMEOUT" },
            },
          ],
        });
      }
    }, ms);
    timer.unref();

    res.on("finish", () => clearTimeout(timer));
    res.on("close", () => clearTimeout(timer));

    next();
  };
}

module.exports = { requestTimeoutMiddleware, getTimeoutMs, DEFAULT_TIMEOUT_MS };

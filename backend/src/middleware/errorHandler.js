/**
 * src/middleware/errorHandler.js
 * The Express error middleware chain (#635): body-parse failures, unmatched
 * routes, and the terminal handler.
 *
 * All three answer with the RFC 7807 `application/problem+json` envelope built
 * by src/utils/errorResponse.js, so a client can parse any error the API emits
 * the same way. Register them in this order:
 *
 *   app.use(bodyParserErrorHandler);  // right after the body parsers
 *   ...routes...
 *   app.use(notFoundHandler);
 *   app.use(errorHandler);            // last
 */

"use strict";

const { ERROR_CODES } = require("../../../shared/errorCodes");
const { sendError, errorLogFields, statusForCode } = require("../utils/errorResponse");
const logger = require("../utils/logger");

// ─── Message sanitization (#206) ─────────────────────────────────────────────
// Stellar secret keys: 'S' + 55 base32 chars [A-Z2-7]. Strip before logging or
// sending to Sentry/clients so a mis-routed key never appears in outputs.

const STELLAR_SECRET_PATTERN = /S[A-Z2-7]{55}/g;

/**
 * @param {*} msg
 * @returns {*} `msg` with any Stellar secret key replaced by `[REDACTED]`.
 */
function sanitizeMessage(msg) {
  return typeof msg === "string" ? msg.replace(STELLAR_SECRET_PATTERN, "[REDACTED]") : msg;
}

/**
 * Internal messages safe to echo as `detail`. An unexpected error's message can
 * carry a stack frame, a driver error, or a file path, so anything not matched
 * here is replaced by the SRV_INTERNAL registry message.
 */
const SAFE_DETAIL_PATTERNS = [
  /^CORS: origin \S+ not allowed$/,
  /^Only CSV files are allowed$/,
  /^File too large$/,
];

/**
 * The `detail` for an error with no catalogue code.
 *
 * @param {*} message - The raw `err.message`.
 * @returns {string}
 */
function safeDetail(message) {
  const clean = sanitizeMessage(message);
  const allowed =
    typeof clean === "string" && SAFE_DETAIL_PATTERNS.some((pattern) => pattern.test(clean));
  return allowed ? clean : ERROR_CODES.SRV_INTERNAL.message;
}

/**
 * Translate body-parser failures into catalogue codes. Mount immediately after
 * the body parsers so a malformed payload never reaches a route.
 */
function bodyParserErrorHandler(err, req, res, next) {
  if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
    return sendError(res, "VAL_INVALID_JSON");
  }
  if (err.type === "entity.too.large" || err.status === 413) {
    return sendError(res, "VAL_BODY_TOO_LARGE");
  }
  return next(err);
}

/** Terminal 404 for requests that matched no route. */
function notFoundHandler(req, res) {
  const sanitizedPath = req.path.replace(/[\r\n]/g, "");
  const log = req.log || logger;
  log.warn({ method: req.method, path: sanitizedPath }, "Route not found");
  return sendError(res, "RES_ROUTE_NOT_FOUND");
}

/**
 * Terminal error handler. Errors carrying an `errorCode` (see
 * `createError`) render that code; anything else is an unexpected failure and
 * renders SRV_INTERNAL, whose `detail` never exposes the raw message.
 */
function errorHandler(err, req, res, next) {
  void next;
  const log = (req && req.log) || logger;

  if (err.errorCode) {
    const status = err.status || statusForCode(err.errorCode);
    log.error(
      { ...errorLogFields(err.errorCode, { details: err.details }), status },
      "Request error",
    );
    return sendError(res, err.errorCode, { details: err.details, status });
  }

  const status = err.status || 500;
  const message = sanitizeMessage(err.message) || ERROR_CODES.SRV_INTERNAL.message;
  log.error({ ...errorLogFields("SRV_INTERNAL"), status, message }, "Request error");
  return sendError(res, "SRV_INTERNAL", { status, message: safeDetail(err.message) });
}

module.exports = {
  bodyParserErrorHandler,
  notFoundHandler,
  errorHandler,
  sanitizeMessage,
};

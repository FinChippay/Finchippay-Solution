/**
 * src/middleware/auth.js
 * JWT verification middleware for SEP-0010 authenticated routes.
 *
 * Every JWT contains `{ publicKey: string, iat: number, exp: number }`.
 * After successful verification `req.user.publicKey` is available to
 * downstream middleware and controllers.
 *
 * Important: `JWT_SECRET` must be at least 32 random bytes in production.
 * Generate one with:  openssl rand -hex 32
 */
"use strict";

const jwt = require("jsonwebtoken");
const { formatErrorResponse, ERROR_CODES } = require("../../../shared/errorCodes");

const JWT_SECRET = process.env.JWT_SECRET || "finchippay_secret_key";

// Warn loudly in development if the default secret is in use.
if (!process.env.JWT_SECRET && process.env.NODE_ENV !== "test") {
  console.warn(
    "⚠️  JWT_SECRET is not set — using insecure default. " +
      "Generate a production secret: openssl rand -hex 32"
  );
}

/**
 * Verify the Bearer JWT from the Authorization header.
 *
 * On success sets `req.user = { publicKey }` for downstream use.
 * On failure returns 401 with a descriptive error.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
function verifyJWT(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res
      .status(ERROR_CODES.AUTH_MISSING_HEADER.httpStatus)
      .json(formatErrorResponse("AUTH_MISSING_HEADER"));
  }

  const token = authHeader.split(" ")[1];
  if (!token || token.length < 10) {
    return res
      .status(ERROR_CODES.AUTH_INVALID_TOKEN.httpStatus)
      .json(formatErrorResponse("AUTH_INVALID_TOKEN"));
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (!decoded.publicKey || !/^G[A-Z0-9]{55}$/.test(decoded.publicKey)) {
      return res
        .status(ERROR_CODES.AUTH_INVALID_TOKEN.httpStatus)
        .json(formatErrorResponse("AUTH_INVALID_TOKEN", { reason: "Token payload is malformed." }));
    }
    req.user = decoded; // { publicKey: "G...", iat, exp }
    next();
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      // Emits the legacy TOKEN_EXPIRED code rather than AUTH_EXPIRED_TOKEN:
      // it is documented and asserted by existing consumers. It is registered
      // in the catalogue as a deprecated alias so it still resolves and still
      // carries a correlation ID (#270).
      return res
        .status(ERROR_CODES.TOKEN_EXPIRED.httpStatus)
        .json(formatErrorResponse("TOKEN_EXPIRED", { expiredAt: err.expiredAt }));
    }
    const errorCode = "AUTH_INVALID_TOKEN";
    return res
      .status(ERROR_CODES[errorCode].httpStatus)
      .json(formatErrorResponse(errorCode, { reason: err.message }));
  }
}

module.exports = { verifyJWT, JWT_SECRET };

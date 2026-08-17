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
const logger = require("../utils/logger");
const { sendError } = require("../utils/errorResponse");

/**
 * JWT signing secret — MUST be configured in all non-test environments.
 *
 * In production this is enforced by validateEnv.js which exits the process.
 * In development we throw early so the developer sees a clear error rather
 * than silently accepting the insecure default.
 *
 * Generate with:  openssl rand -hex 32
 */
const JWT_SECRET =
  process.env.JWT_SECRET ||
  (process.env.NODE_ENV === "test"
    ? "test-jwt-secret-for-unit-tests-only"
    : (() => {
        throw new Error("JWT_SECRET is not set. Generate one: openssl rand -hex 32");
      })());

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
    return sendError(res, "AUTH_MISSING_HEADER");
  }

  const token = authHeader.split(" ")[1];
  if (!token || token.length < 10) {
    return sendError(res, "AUTH_INVALID_TOKEN");
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (!decoded.publicKey || !/^G[A-Z0-9]{55}$/.test(decoded.publicKey)) {
      return sendError(res, "AUTH_INVALID_TOKEN", {
        details: { reason: "Token payload is malformed." },
      });
    }
    req.user = {
      ...decoded,
      sub: decoded.publicKey, // Add sub for userRateLimit middleware
    }; // { publicKey: "G...", sub, iat, exp }
    next();
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      // Emits the legacy TOKEN_EXPIRED code rather than AUTH_EXPIRED_TOKEN:
      // it is documented and asserted by existing consumers. It is registered
      // in the catalogue as a deprecated alias so it still resolves and still
      // carries a correlation ID (#270).
      return sendError(res, "TOKEN_EXPIRED", { details: { expiredAt: err.expiredAt } });
    }
    return sendError(res, "AUTH_INVALID_TOKEN", { details: { reason: err.message } });
  }
}

/**
 * Restrict an authenticated route to explicitly configured Stellar accounts.
 *
 * ADMIN_PUBLIC_KEYS is read per request so deployments can rotate the
 * comma-separated allowlist without embedding authorization data in tokens.
 * An empty allowlist fails closed.
 */
function requireAdmin(req, res, next) {
  const adminPublicKeys = new Set(
    String(process.env.ADMIN_PUBLIC_KEYS || "")
      .split(",")
      .map((publicKey) => publicKey.trim())
      .filter(Boolean),
  );

  if (!req.user?.publicKey || !adminPublicKeys.has(req.user.publicKey)) {
    return sendError(res, "AUTH_FORBIDDEN");
  }

  return next();
}

module.exports = { verifyJWT, requireAdmin, JWT_SECRET };

/**
 * src/middleware/adminAuth.js
 * Admin authentication middleware.
 *
 * Accepts either:
 *   a) A Bearer JWT whose decoded payload carries `{ role: "admin" }`, OR
 *   b) A static ADMIN_API_KEY token supplied via the Authorization header.
 *
 * Non-admin users receive HTTP 403 AUTH_FORBIDDEN.
 *
 * Generate an API key:  openssl rand -hex 32
 * Set it in backend/.env:  ADMIN_API_KEY=<generated value>
 */

"use strict";

const jwt = require("jsonwebtoken");
const { formatErrorResponse, ERROR_CODES } = require("../../../shared/errorCodes");
const { JWT_SECRET } = require("./auth");

const ADMIN_API_KEY = process.env.ADMIN_API_KEY;

if (!ADMIN_API_KEY && process.env.NODE_ENV !== "test") {
  console.warn(
    "⚠️  ADMIN_API_KEY is not set — admin routes are effectively disabled. " +
      "Generate one: openssl rand -hex 32"
  );
}

/**
 * Express middleware that gates access to admin-only routes.
 *
 * Strategy (tried in order):
 *   1. If the Authorization header holds the static ADMIN_API_KEY → allow.
 *   2. If the header holds a valid JWT with `role: "admin"` → allow.
 *   3. Otherwise → 403.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
function requireAdmin(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res
      .status(ERROR_CODES.AUTH_MISSING_HEADER.httpStatus)
      .json(formatErrorResponse("AUTH_MISSING_HEADER"));
  }

  const token = authHeader.split(" ")[1];

  // Strategy 1: static API key
  if (ADMIN_API_KEY && token === ADMIN_API_KEY) {
    req.admin = { via: "api_key" };
    return next();
  }

  // Strategy 2: JWT with admin role
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== "admin") {
      return res
        .status(ERROR_CODES.AUTH_FORBIDDEN.httpStatus)
        .json(
          formatErrorResponse("AUTH_FORBIDDEN", {
            reason: "Admin role required.",
          })
        );
    }
    req.admin = { via: "jwt", publicKey: decoded.publicKey };
    return next();
  } catch {
    // Neither a valid API key nor a valid admin JWT
    return res
      .status(ERROR_CODES.AUTH_FORBIDDEN.httpStatus)
      .json(
        formatErrorResponse("AUTH_FORBIDDEN", {
          reason: "Valid admin credentials required.",
        })
      );
  }
}

module.exports = { requireAdmin };

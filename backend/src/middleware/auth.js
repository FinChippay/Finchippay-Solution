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

const JWT_SECRET = process.env.JWT_SECRET || "finchippay_secret_key";

// Warn loudly in development if the default secret is in use.
if (!process.env.JWT_SECRET && process.env.NODE_ENV !== "test") {
  console.warn(
    "⚠️  JWT_SECRET is not set — using insecure default. " +
      "Generate a production secret: openssl rand -hex 32",
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
    return res.status(401).json({
      error:
        "Unauthorized: missing or invalid Authorization header. Expected 'Bearer <token>'.",
    });
  }

  const token = authHeader.split(" ")[1];
  if (!token || token.length < 10) {
    return res
      .status(401)
      .json({ error: "Unauthorized: token is missing or too short." });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (!decoded.publicKey || !/^G[A-Z0-9]{55}$/.test(decoded.publicKey)) {
      return res
        .status(401)
        .json({ error: "Unauthorized: token payload is malformed." });
    }
    req.user = decoded; // { publicKey: "G...", iat, exp }
    next();
  } catch (err) {
    const message =
      err.name === "TokenExpiredError"
        ? "Unauthorized: token has expired. Re-authenticate via SEP-0010."
        : "Unauthorized: invalid or malformed token.";
    return res.status(401).json({ error: message });
  }
}

module.exports = { verifyJWT, JWT_SECRET };

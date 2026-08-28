/**
 * src/middleware/bodyParsing.js
 * JSON Content-Type enforcement for request bodies with configurable size limits (#81, #353).
 *
 * express.json() silently skips parsing when the Content-Type doesn't match
 * "application/json" — it does not error, so a client that sends a JSON body
 * with the wrong Content-Type ends up with an empty req.body instead of a
 * useful error. requireJsonContentType() rejects that case explicitly with
 * 415 before the body parser runs.
 *
 * Body size limits are configurable via environment variables:
 *   BODY_LIMIT_JSON        — max JSON payload size (default: 1mb)
 *   BODY_LIMIT_URLENCODED  — max URL-encoded payload size (default: 100kb)
 */

"use strict";

const express = require("express");

const JSON_BODY_METHODS = new Set(["POST", "PUT"]);

const BODY_LIMIT_JSON = process.env.BODY_LIMIT_JSON || "1mb";
const BODY_LIMIT_URLENCODED = process.env.BODY_LIMIT_URLENCODED || "100kb";

/**
 * Reject POST/PUT requests whose Content-Type is not application/json
 * (optionally with a charset, e.g. "application/json; charset=utf-8").
 */
function requireJsonContentType(req, res, next) {
  if (!JSON_BODY_METHODS.has(req.method)) {
    return next();
  }

  const contentType = req.headers["content-type"] || "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return res.status(415).json({ error: "Content-Type must be application/json" });
  }

  next();
}

/**
 * express.json()'s `verify` callback — stashes the exact bytes received on
 * `req.rawBody` before JSON parsing. Inbound webhook signature verification
 * (verifyInboundWebhookSignature.js) needs the raw bytes: re-serializing
 * `req.body` with JSON.stringify() is not guaranteed to reproduce the exact
 * string the sender signed (key order, whitespace, unicode escaping can all
 * differ), which would make a correctly-signed request fail verification.
 */
function rawBodySaver(req, _res, buf) {
  req.rawBody = buf;
}

/**
 * Build a JSON body parser with raw-body capture enabled. Exported so test
 * apps can mount the exact same parser used in production (see
 * bodyParsing(app) below) rather than a plain express.json() that would
 * leave req.rawBody undefined.
 */
function jsonBodyParser(options = {}) {
  return express.json({ limit: BODY_LIMIT_JSON, verify: rawBodySaver, ...options });
}

/**
 * Apply body parsing middleware with configurable size limits.
 * Mount this on the Express app before routes.
 */
function bodyParsing(app) {
  app.use(jsonBodyParser());
  app.use(express.urlencoded({ extended: true, limit: BODY_LIMIT_URLENCODED }));
}

module.exports = {
  requireJsonContentType,
  bodyParsing,
  jsonBodyParser,
  BODY_LIMIT_JSON,
  BODY_LIMIT_URLENCODED,
};

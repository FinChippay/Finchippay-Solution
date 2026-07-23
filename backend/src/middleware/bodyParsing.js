/**
 * src/middleware/bodyParsing.js
 * JSON Content-Type enforcement for request bodies (#81).
 *
 * express.json() silently skips parsing when the Content-Type doesn't match
 * "application/json" — it does not error, so a client that sends a JSON body
 * with the wrong Content-Type ends up with an empty req.body instead of a
 * useful error. requireJsonContentType() rejects that case explicitly with
 * 415 before the body parser runs.
 */

"use strict";

const JSON_BODY_METHODS = new Set(["POST", "PUT"]);

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
    return res
      .status(415)
      .json({ error: "Content-Type must be application/json" });
  }

  next();
}

module.exports = { requireJsonContentType };

/**
 * src/middleware/deprecation.js
 * Marks legacy /api/* routes as deprecated while v1 aliases remain available.
 */

"use strict";

function deprecationHeader(req, res, next) {
  res.setHeader("Deprecation", "true");
  next();
}

module.exports = { deprecationHeader };

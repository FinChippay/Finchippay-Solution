/**
 * src/middleware/pagination.js
 * Standardizes `?limit=` and `?cursor=` parsing for every list endpoint (#74).
 *
 * Runs before list controllers and writes a normalized `req.pagination`:
 *
 *   { limit: number, cursor: object | null }
 *
 * `limit` defaults to 20, must be a positive integer, and is capped at 100
 * server-side. `cursor`, when present, is the decoded sort-key object produced
 * by `utils/paginate.encodeCursor` on a previous page; a malformed cursor is
 * rejected with `VAL_INVALID_CURSOR` rather than silently ignored.
 */

"use strict";

const { sendError } = require("../utils/errorResponse");
const { decodeCursor, InvalidCursorError } = require("../utils/paginate");

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/**
 * Express middleware that populates `req.pagination`.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
function paginationMiddleware(req, res, next) {
  const { limit: rawLimit, cursor: rawCursor } = req.query;

  let limit = DEFAULT_LIMIT;
  if (rawLimit !== undefined && rawLimit !== "") {
    const parsed = Number(rawLimit);
    if (!Number.isInteger(parsed) || parsed < 1) {
      return sendError(res, "VAL_INVALID_LIMIT", {
        details: { field: "limit" },
      });
    }
    limit = Math.min(parsed, MAX_LIMIT);
  }

  let cursor = null;
  if (rawCursor !== undefined && rawCursor !== "") {
    try {
      cursor = decodeCursor(rawCursor);
    } catch (err) {
      if (err instanceof InvalidCursorError) {
        return sendError(res, "VAL_INVALID_CURSOR", {
          details: { field: "cursor" },
        });
      }
      throw err;
    }
  }

  req.pagination = { limit, cursor };
  next();
}

paginationMiddleware.pagination = paginationMiddleware;
paginationMiddleware.paginationMiddleware = paginationMiddleware;
paginationMiddleware.DEFAULT_LIMIT = DEFAULT_LIMIT;
paginationMiddleware.MAX_LIMIT = MAX_LIMIT;

module.exports = paginationMiddleware;

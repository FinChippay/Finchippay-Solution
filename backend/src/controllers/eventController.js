/**
 * src/controllers/eventController.js
 * HTTP handlers for contract event queries.
 *
 * Routes handled:
 *   GET /api/events/:publicKey        → paginated contract events
 *   GET /api/events/:publicKey/stats  → aggregate event-type counts
 */

"use strict";

const eventIndexer = require("../services/eventIndexer");
const logger = require("../utils/logger");
const { sendError } = require("../utils/errorResponse");
const {
  encodeCursor,
  decodeCursor,
  InvalidCursorError,
  setPaginationHeaders,
  formatPaginatedResponse,
} = require("../utils/paginate");

/**
 * GET /api/events/:publicKey
 *
 * Return paginated contract events where the given public key
 * appears as a participant (sender, recipient, signer, etc.).
 *
 * Query params (validated by eventsQuerySchema):
 *   - limit  {number} 1–100 (default 20)
 *   - offset {number} 0-based (default 0)
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
async function getEvents(req, res, next) {
  try {
    const { publicKey, limit } = req.validated;
    let { offset } = req.validated;

    // An opaque cursor takes precedence over a raw offset and encodes the next
    // offset (keyset-style navigation over the same ledger_sequence,id order).
    const rawCursor = req.query.cursor;
    if (rawCursor !== undefined && rawCursor !== "") {
      let decoded;
      try {
        decoded = decodeCursor(rawCursor);
      } catch (err) {
        if (err instanceof InvalidCursorError) {
          return sendError(res, "VAL_INVALID_CURSOR", {
            details: { parameter: "cursor" },
          });
        }
        throw err;
      }
      offset = Number(decoded.offset);
      if (!Number.isSafeInteger(offset) || offset < 0) {
        return sendError(res, "VAL_INVALID_CURSOR", {
          details: { parameter: "cursor" },
        });
      }
    }

    const { events, total } = await eventIndexer.queryEventsByPublicKey(publicKey, {
      limit,
      offset,
    });

    const hasMore = offset + limit < total;
    const nextCursor = hasMore ? encodeCursor({ offset: offset + limit }) : null;
    setPaginationHeaders(req, res, { nextCursor, total, limit });

    res.json(formatPaginatedResponse(events, nextCursor, total, { limit, offset, hasMore }));
  } catch (err) {
    logger.error({ err, publicKey: req.params.publicKey }, "getEvents error");
    next(err);
  }
}

/**
 * GET /api/events/:publicKey/stats
 *
 * Return aggregate counts grouped by event type for the given public key.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
async function getStats(req, res, next) {
  try {
    const { publicKey } = req.validated;
    const stats = await eventIndexer.getEventStats(publicKey);

    const totalEvents = stats.reduce((sum, s) => sum + s.count, 0);

    res.json({
      success: true,
      data: {
        publicKey,
        totalEvents,
        breakdown: stats,
      },
    });
  } catch (err) {
    logger.error({ err, publicKey: req.params.publicKey }, "getStats (events) error");
    next(err);
  }
}

/**
 * GET /api/events/:publicKey/:eventType
 *
 * Return paginated contract events filtered by both participant address
 * and event type.
 *
 * Query params:
 *   - limit  {number} 1–100 (default 20)
 *   - offset {number} 0-based (default 0)
 *   - since  {string} ISO 8601 timestamp
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
async function getEventsByType(req, res, next) {
  try {
    const { publicKey, eventType } = req.params;
    const { limit = 20, offset = 0, since } = req.validated || req.query;

    const { events, total } = await eventIndexer.queryEventsByType(publicKey, eventType, {
      limit: Number(limit),
      offset: Number(offset),
      since,
    });

    const hasMore = offset + limit < total;
    const nextCursor = hasMore ? encodeCursor({ offset: offset + limit }) : null;
    setPaginationHeaders(req, res, { nextCursor, total, limit });

    res.json(formatPaginatedResponse(events, nextCursor, total, { limit, offset, hasMore }));
  } catch (err) {
    logger.error(
      { err, publicKey: req.params.publicKey, eventType: req.params.eventType },
      "getEventsByType error",
    );
    next(err);
  }
}

module.exports = { getEvents, getStats, getEventsByType };

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

/**
 * GET /api/events/:publicKey
 *
 * Return paginated contract events where the given public key
 * appears as a participant (sender, recipient, signer, etc.).
 *
 * Query params:
 *   - limit  {number} 1–100 (default 20)
 *   - offset {number} 0-based (default 0)
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
async function getEvents(req, res, next) {
  try {
    const { publicKey } = req.params;

    const rawLimit = req.query.limit;
    let limit = 20;
    if (rawLimit !== undefined) {
      const parsed = parseInt(rawLimit, 10);
      if (isNaN(parsed) || !Number.isSafeInteger(parsed) || parsed < 1) {
        return res
          .status(400)
          .json({ error: "limit must be a positive integer" });
      }
      limit = Math.min(parsed, 100);
    }

    const rawOffset = req.query.offset;
    let offset = 0;
    if (rawOffset !== undefined) {
      const parsed = parseInt(rawOffset, 10);
      if (isNaN(parsed) || !Number.isSafeInteger(parsed) || parsed < 0) {
        return res
          .status(400)
          .json({ error: "offset must be a non-negative integer" });
      }
      offset = parsed;
    }

    const { events, total } = await eventIndexer.queryEventsByPublicKey(
      publicKey,
      { limit, offset },
    );

    res.json({
      success: true,
      data: events,
      pagination: {
        limit,
        offset,
        total,
        hasMore: offset + limit < total,
      },
    });
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
    const { publicKey } = req.params;
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
    logger.error(
      { err, publicKey: req.params.publicKey },
      "getStats (events) error",
    );
    next(err);
  }
}

module.exports = { getEvents, getStats };

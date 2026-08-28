/**
 * src/controllers/tipsController.js
 * HTTP handlers for the Finchippay on-chain tips feature.
 *
 * Tips are one-shot token transfers from a sender to a creator's Stellar
 * address. This API layer records and queries tips stored in `tipsService`
 * (Knex-backed SQLite/PostgreSQL).
 *
 * Routes handled:
 *   POST /api/tips                               → record a new tip
 *   GET  /api/tips/received/:creatorPublicKey    → list tips received + stats
 *   GET  /api/tips/stats/:creatorPublicKey     → tip statistics only
 *   GET  /api/tips/sent/:senderPublicKey       → list tips sent by a user
 */

"use strict";

const tipsService = require("../services/tipsService");
const pushNotifier = require("../services/pushNotifier");
const { buildPage, setPaginationHeaders, formatPaginatedResponse } = require("../utils/paginate");

// Extract the keyset cursor fields from a mapped tip record. `timestamp` holds
// the row's `created_at`; `id` is the unique tiebreaker.
const tipCursor = (tip) => ({ created_at: tip.timestamp, id: tip.id });

// Lazy-loaded to avoid circular dependency at parse time
function getCache() {
  try {
    return require("../services/cacheService");
  } catch {
    return null;
  }
}

/**
 * POST /api/tips
 * Record a new tip after the on-chain transaction has been confirmed.
 *
 * Body:
 *   senderPublicKey / creatorPublicKey / amount / asset / memo / txHash
 */
async function recordTip(req, res, next) {
  try {
    // Input has already been validated by `tipSchema` (see validate()
    // middleware) — asset defaults to "XLM", amount is a positive decimal
    // string, both keys are valid Stellar addresses.
    const { senderPublicKey, creatorPublicKey, amount, asset, memo, txHash } = req.validated;

    const tip = await tipsService.recordTip({
      senderPublicKey,
      creatorPublicKey,
      amount,
      asset,
      memo: memo || "",
      txHash: txHash || "",
    });

    // Invalidate analytics cache on new tip
    try {
      const cache = getCache();
      if (cache) {
        await cache.delPattern("analytics:*");
      }
    } catch {
      // cache invalidation is best-effort
    }

    // Notify the creator's registered devices. Best-effort for the same reason
    // as the cache invalidation above: the tip is already recorded, and a push
    // failure must not turn a successful tip into an error for the sender.
    try {
      await pushNotifier.notifyTipReceived({
        creatorPublicKey,
        amount,
        asset,
      });
    } catch {
      // push delivery is best-effort
    }

    return res.status(201).json({
      success: true,
      data: tip,
      message: "Tip recorded successfully",
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/tips/received/:creatorPublicKey
 * Return paginated tips received by a creator, including aggregate stats.
 */
async function getTipsReceived(req, res, next) {
  try {
    const { creatorPublicKey } = req.validated;
    const { limit, cursor } = req.pagination;

    const { tips, total } = await tipsService.getTipsReceived(creatorPublicKey, {
      limit,
      cursor,
    });
    const stats = await tipsService.getTipsStats(creatorPublicKey);

    const { data, nextCursor } = buildPage(tips, limit, tipCursor);
    setPaginationHeaders(req, res, { nextCursor, total, limit });

    const formatted = formatPaginatedResponse(data, nextCursor, total, { limit });
    return res.json({
      ...formatted,
      stats,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/tips/stats/:creatorPublicKey
 * Return aggregate tip statistics for a creator without the full tip list.
 */
async function getTipsStats(req, res, next) {
  try {
    const { creatorPublicKey } = req.validated;
    const stats = await tipsService.getTipsStats(creatorPublicKey);
    return res.json({ success: true, data: stats });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/tips/sent/:senderPublicKey
 * Return paginated tips sent by a user.
 */
async function getTipsSent(req, res, next) {
  try {
    const { senderPublicKey } = req.validated;
    const { limit, cursor } = req.pagination;

    const { tips, total } = await tipsService.getTipsSent(senderPublicKey, {
      limit,
      cursor,
    });

    const { data, nextCursor } = buildPage(tips, limit, tipCursor);
    setPaginationHeaders(req, res, { nextCursor, total, limit });

    return res.json(formatPaginatedResponse(data, nextCursor, total, { limit }));
  } catch (err) {
    next(err);
  }
}

module.exports = { recordTip, getTipsReceived, getTipsStats, getTipsSent };

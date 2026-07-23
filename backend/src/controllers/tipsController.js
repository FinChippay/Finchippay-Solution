/**
 * src/controllers/tipsController.js
 * HTTP handlers for the Finchippay on-chain tips feature.
 *
 * Tips are one-shot token transfers from a sender to a creator's Stellar
 * address. This API layer records and queries tips stored in `tipsService`
 * (in-memory v1 store; swap for a database in production).
 *
 * Routes handled:
 *   POST /api/tips                            → record a new tip
 *   GET  /api/tips/received/:creatorPublicKey → list tips received + stats
 *   GET  /api/tips/stats/:creatorPublicKey    → tip statistics only
 *   GET  /api/tips/sent/:senderPublicKey      → list tips sent by a user
 */

"use strict";

const tipsService = require("../services/tipsService");

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
 * Body: {
 *   senderPublicKey:  string,   // Stellar G… address of the sender
 *   creatorPublicKey: string,   // Stellar G… address of the creator
 *   amount:           string,   // Amount sent (e.g. "10.0000000")
 *   asset?:           string,   // Asset code (default "XLM")
 *   memo?:            string,   // Optional message from sender
 *   txHash?:          string    // Stellar transaction hash for verification
 * }
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 *
 * @returns {201} { success: true, data: TipRecord, message }
 * @returns {400} Validation error — missing or invalid fields.
 */
async function recordTip(req, res, next) {
  try {
    const { senderPublicKey, creatorPublicKey, amount, asset, memo, txHash } = req.body;

    tipsService.validateTipInput({ senderPublicKey, creatorPublicKey, amount });

    const tip = tipsService.recordTip({
      senderPublicKey,
      creatorPublicKey,
      amount,
      asset: asset || "XLM",
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
 *
 * Query params:
 *   - `limit`  {number} max records (default 50)
 *   - `offset` {number} records to skip for pagination (default 0)
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 *
 * @returns {200} { success: true, data: { tips, total, limit, offset, stats } }
 * @returns {400} Invalid public key format.
 */
async function getTipsReceived(req, res, next) {
  try {
    const { creatorPublicKey } = req.params;
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : undefined;
    const offset = req.query.offset ? parseInt(req.query.offset, 10) : undefined;

    const result = tipsService.getTipsReceived(creatorPublicKey, { limit, offset });
    const stats = tipsService.getTipsStats(creatorPublicKey);

    return res.json({ success: true, data: { ...result, stats } });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/tips/stats/:creatorPublicKey
 * Return aggregate tip statistics for a creator without the full tip list.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 *
 * @returns {200} { success: true, data: { totalTips, totalByAsset, averageTip, largestTip, smallestTip } }
 * @returns {400} Invalid public key format.
 */
async function getTipsStats(req, res, next) {
  try {
    const { creatorPublicKey } = req.params;
    const stats = tipsService.getTipsStats(creatorPublicKey);
    return res.json({ success: true, data: stats });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/tips/sent/:senderPublicKey
 * Return paginated tips sent by a user.
 *
 * Query params:
 *   - `limit`  {number} max records (default 50)
 *   - `offset` {number} records to skip for pagination (default 0)
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 *
 * @returns {200} { success: true, data: { tips, total, limit, offset } }
 * @returns {400} Invalid public key format.
 */
async function getTipsSent(req, res, next) {
  try {
    const { senderPublicKey } = req.params;
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : undefined;
    const offset = req.query.offset ? parseInt(req.query.offset, 10) : undefined;

    const result = tipsService.getTipsSent(senderPublicKey, { limit, offset });
    return res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

module.exports = { recordTip, getTipsReceived, getTipsStats, getTipsSent };

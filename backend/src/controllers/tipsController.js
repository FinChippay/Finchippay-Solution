/**
 * src/controllers/tipsController.js
 * HTTP handlers for the Finchippay on-chain tips feature.
 *
 * Tips are one-shot token transfers from a sender to a creator's Stellar
 * address. This API layer records and queries tips stored in `tipsService`
 * (Knex-backed SQLite/PostgreSQL).
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
 * Body:
 *   senderPublicKey / creatorPublicKey / amount / asset / memo / txHash
 */
async function recordTip(req, res, next) {
  try {
 160-issue-38-rtl-language-support-arabic-hebrew-fix
    // Input has already been validated by `tipSchema` (see validate()
    // middleware) — asset defaults to "XLM", amount is a positive decimal
    // string, both keys are valid Stellar addresses.
    const { senderPublicKey, creatorPublicKey, amount, asset, memo, txHash } =
      req.validated;

 #136-Issue-#14-Database-Backed-Turrets-with-Price-Feed-Fallbacks-FIX
    tipsService.validateTipInput({ senderPublicKey, creatorPublicKey, amount });

    const { senderPublicKey, creatorPublicKey, amount, asset, memo, txHash } =
      req.body;

    tipsService.validateTipInput({ senderPublicKey, creatorPublicKey, amount });
 master

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
 160-issue-38-rtl-language-support-arabic-hebrew-fix
    const { creatorPublicKey, limit, offset } = req.validated;

    const result = await tipsService.getTipsReceived(creatorPublicKey, {
      limit,
      offset,
    });
    const stats = await tipsService.getTipsStats(creatorPublicKey);

    const { creatorPublicKey } = req.params;
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : undefined;
    const offset = req.query.offset
      ? parseInt(req.query.offset, 10)
      : undefined;

    const result = await tipsService.getTipsReceived(creatorPublicKey, {
      limit,
      offset,
    });
    const stats = await tipsService.getTipsStats(creatorPublicKey);
 master

    return res.json({ success: true, data: { ...result, stats } });
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
 160-issue-38-rtl-language-support-arabic-hebrew-fix
    const { creatorPublicKey } = req.validated;
 #136-Issue-#14-Database-Backed-Turrets-with-Price-Feed-Fallbacks-FIX
    const stats = await tipsService.getTipsStats(creatorPublicKey);

    const stats = tipsService.getTipsStats(creatorPublicKey);

    const { creatorPublicKey } = req.params;
    const stats = await tipsService.getTipsStats(creatorPublicKey);
 master
 master
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
 160-issue-38-rtl-language-support-arabic-hebrew-fix
    const { senderPublicKey, limit, offset } = req.validated;

 #136-Issue-#14-Database-Backed-Turrets-with-Price-Feed-Fallbacks-FIX

    const { senderPublicKey } = req.params;
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : undefined;
    const offset = req.query.offset
      ? parseInt(req.query.offset, 10)
      : undefined;
 master

 master
    const result = await tipsService.getTipsSent(senderPublicKey, {
      limit,
      offset,
    });
    return res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

module.exports = { recordTip, getTipsReceived, getTipsStats, getTipsSent };

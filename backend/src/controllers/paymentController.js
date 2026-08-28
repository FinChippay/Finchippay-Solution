/**
 * src/controllers/paymentController.js
 * HTTP handlers for payment history and statistics.
 *
 * Routes handled:
 *   GET /api/payments/:publicKey         → paginated payment history
 *   GET /api/payments/:publicKey/stats   → aggregate sent/received statistics
 *
 * Both endpoints proxy Stellar Horizon data via `stellarService`, which
 * applies a 5-second LRU cache and timeout/retry logic.
 */

"use strict";

const stellarService = require("../services/stellarService");
const { setPaginationHeaders, formatPaginatedResponse } = require("../utils/paginate");

/**
 * GET /api/payments/:publicKey
 * Return paginated payment history for a Stellar account.
 *
 * Query params (validated by `paymentsQuerySchema`):
 *   - `limit`  {number} 1–100 (default 20) — max records per page
 *   - `cursor` {string} Horizon paging token for cursor-based pagination
 *
 * Emits the standardized pagination headers (#74): an RFC 5988 `Link`
 * (rel="next") derived from the last record's Horizon paging token, and an
 * `X-Total-Count` carrying a bounded, approximate total — Horizon exposes no
 * exact count, so it is a floor capped at 200 (see `countPaymentsApprox`).
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 *
 * @returns {200} { success: true, data: PaymentRecord[], pagination }
 * @returns {400} Invalid public key format or invalid `limit` parameter.
 * @returns {404} Account not found on the Stellar network.
 */
async function getPayments(req, res, next) {
  try {
    const publicKey = req.validated?.publicKey || req.params.publicKey;
    const limit = req.pagination?.limit || req.validated?.limit || 20;
    const cursor = req.pagination?.rawCursor || req.validated?.cursor || req.query.cursor || null;

    const [payments, total] = await Promise.all([
      stellarService.getPayments(publicKey, { limit, cursor }),
      stellarService.countPaymentsApprox(publicKey),
    ]);

    // A full page implies there may be more; the next cursor is Horizon's own
    // paging token on the last record. A short page is treated as the last page.
    const nextCursor =
      payments.length === limit && payments.length > 0
        ? payments[payments.length - 1].pagingToken
        : null;

    setPaginationHeaders(req, res, { nextCursor, total, limit });

    res.json(formatPaginatedResponse(payments, nextCursor, total, { limit }));
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/payments/:publicKey/stats
 * Return aggregate payment statistics (total sent XLM, total received XLM,
 * transaction counts) for the most recent 100 payments.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 *
 * @returns {200} { success: true, data: {
 *   publicKey, totalSentXLM, totalReceivedXLM,
 *   sentCount, receivedCount, totalTransactions
 * }}
 * @returns {400} Invalid public key format.
 * @returns {404} Account not found on the Stellar network.
 */
async function getStats(req, res, next) {
  try {
    const { publicKey } = req.validated;

    const payments = await stellarService.getPayments(publicKey, {
      limit: 100,
    });

    let totalSent = 0;
    let totalReceived = 0;
    let sentCount = 0;
    let receivedCount = 0;

    for (const p of payments) {
      const amount = parseFloat(p.amount);
      if (p.type === "sent") {
        totalSent += amount;
        sentCount++;
      } else {
        totalReceived += amount;
        receivedCount++;
      }
    }

    res.json({
      success: true,
      data: {
        publicKey,
        totalSentXLM: totalSent.toFixed(7),
        totalReceivedXLM: totalReceived.toFixed(7),
        sentCount,
        receivedCount,
        totalTransactions: sentCount + receivedCount,
      },
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { getPayments, getStats };

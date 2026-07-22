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
const { formatErrorResponse, ERROR_CODES } = require("../../../shared/errorCodes");

/**
 * GET /api/payments/:publicKey
 * Return paginated payment history for a Stellar account.
 *
 * Query params:
 *   - `limit`  {number} 1–100 (default 20) — max records per page
 *   - `cursor` {string} Horizon paging token for cursor-based pagination
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 *
 * @returns {200} { success: true, data: PaymentRecord[] }
 * @returns {400} Invalid public key format or invalid `limit` parameter.
 * @returns {404} Account not found on the Stellar network.
 */
async function getPayments(req, res, next) {
  try {
    const { publicKey } = req.params;

    // Explicit limit validation — parseInt("0") or NaN must not silently pass.
    const rawLimit = req.query.limit;
    let limit = 20;
    if (rawLimit !== undefined) {
      const parsed = parseInt(rawLimit, 10);
      if (isNaN(parsed) || !Number.isSafeInteger(parsed) || parsed < 1) {
        return res
          .status(ERROR_CODES.VAL_INVALID_LIMIT.httpStatus)
          .json(formatErrorResponse("VAL_INVALID_LIMIT"));
      }
      limit = Math.min(parsed, 100);
    }

    const cursor = req.query.cursor || undefined;
    const payments = await stellarService.getPayments(publicKey, { limit, cursor });
    res.json({ success: true, data: payments });
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
    const { publicKey } = req.params;
    const payments = await stellarService.getPayments(publicKey, { limit: 100 });

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

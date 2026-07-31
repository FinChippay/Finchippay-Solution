/**
 * src/controllers/analyticsController.js
 * HTTP handlers for transaction volume analytics.
 *
 * Routes handled:
 *   GET /api/analytics/:publicKey/summary        → total sent/received, counterparties
 *   GET /api/analytics/:publicKey/top-recipients → top 5 recipients by XLM sent
 *   GET /api/analytics/:publicKey/activity       → payment count by day of week
 *
 * Results are served from a 5-minute in-memory cache inside `analyticsService`
 * to reduce Horizon API load for frequently-viewed dashboards.
 */

"use strict";

const analyticsService = require("../services/analyticsService");

/**
 * GET /api/analytics/:publicKey/summary
 * Return aggregate payment statistics for a wallet address.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 *
 * @returns {200} { success: true, data: { publicKey, totalSentXLM, totalReceivedXLM,
 *                  uniqueCounterparties, averageTransactionSize, totalTransactions } }
 * @returns {400} Invalid public key format.
 */
async function getSummary(req, res, next) {
  try {
    const { publicKey } = req.validated;
    const data = await analyticsService.getSummary(publicKey);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/analytics/:publicKey/top-recipients
 * Return the top 5 addresses by total XLM sent from this wallet.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 *
 * @returns {200} { success: true, data: { publicKey, topRecipients: [{address, totalXLMSent}], count } }
 * @returns {400} Invalid public key format.
 */
async function getTopRecipients(req, res, next) {
  try {
    const { publicKey } = req.validated;
    const data = await analyticsService.getTopRecipients(publicKey);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/analytics/:publicKey/activity
 * Return payment counts grouped by day of week (Sunday=0 … Saturday=6).
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 *
 * @returns {200} { success: true, data: { publicKey, activityByDay: [{day, dayIndex, transactionCount}] } }
 * @returns {400} Invalid public key format.
 */
async function getActivityByDay(req, res, next) {
  try {
    const { publicKey } = req.validated;
    const data = await analyticsService.getActivityByDay(publicKey);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

module.exports = { getSummary, getTopRecipients, getActivityByDay };

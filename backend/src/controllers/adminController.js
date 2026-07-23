/**
 * src/controllers/adminController.js
 * HTTP handlers for the admin dashboard.
 *
 * All endpoints rely on the AdminAuth middleware to ensure only authorized
 * callers can access system-level data.
 */

"use strict";

const adminService = require("../services/adminService");

/**
 * GET /api/admin/stats
 * Return overall system stats.
 */
async function getSystemStats(req, res, next) {
  try {
    const stats = await adminService.getSystemStats();
    res.json({ success: true, data: stats });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/admin/contract-stats
 * Return on-chain aggregate counts.
 */
async function getContractStats(req, res, next) {
  try {
    const stats = await adminService.getContractStats();
    res.json({ success: true, data: stats });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/admin/recent-errors
 * Return the most recent errors captured globally.
 */
async function getRecentErrors(req, res, next) {
  try {
    const limit = parseInt(req.query.limit, 10) || 50;
    const errors = adminService.getRecentErrors(limit);
    res.json({ success: true, data: errors });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/admin/webhook-health
 * Return webhook delivery reliability metrics.
 */
async function getWebhookHealth(req, res, next) {
  try {
    const health = await adminService.getWebhookHealth();
    res.json({ success: true, data: health });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getSystemStats,
  getContractStats,
  getRecentErrors,
  getWebhookHealth,
};

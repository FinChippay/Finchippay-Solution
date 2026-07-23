/**
 * src/routes/admin.js
 * Routes for the admin dashboard.
 */

"use strict";

const express = require("express");
const router = express.Router();
const { requireAdmin } = require("../middleware/adminAuth");
const { adminLimiter } = require("../middleware/rateLimit");
const adminController = require("../controllers/adminController");

// All admin routes use the admin limiter and require admin auth.
router.use(adminLimiter, requireAdmin);

/**
 * GET /api/admin/stats
 * Returns overall user and transaction counts.
 */
router.get("/stats", adminController.getSystemStats);

/**
 * GET /api/admin/contract-stats
 * Returns escrow, stream, multisig, and tip counts.
 */
router.get("/contract-stats", adminController.getContractStats);

/**
 * GET /api/admin/recent-errors
 * Returns the last 50 error entries.
 */
router.get("/recent-errors", adminController.getRecentErrors);

/**
 * GET /api/admin/webhook-health
 * Returns webhook delivery success rate.
 */
router.get("/webhook-health", adminController.getWebhookHealth);

module.exports = router;

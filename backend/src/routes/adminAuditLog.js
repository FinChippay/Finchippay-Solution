/**
 * src/routes/adminAuditLog.js
 * Admin API endpoint for querying the audit trail (WS5).
 *
 * The audit trail records authz-relevant mutations (webhook CRUD, schedule
 * CRUD/execute, preference changes) with the acting public key and outcome.
 * It is deliberately read-only and admin-gated (verifyJWT + requireAdmin):
 * regular users must not be able to enumerate other accounts' activity.
 */

"use strict";

const express = require("express");
const router = express.Router();
const { verifyJWT, requireAdmin } = require("../middleware/auth");
const auditService = require("../services/auditService");

/**
 * GET /api/admin/audit-log
 * Query audit records, newest first.
 *
 * Query params:
 *   actor       — filter by acting public key
 *   action      — filter by action (e.g. webhook.register)
 *   resourceId  — filter by resource id
 *   limit       — page size (default 100, max 500)
 *   offset      — 0-based offset (default 0)
 */
router.get("/", verifyJWT, requireAdmin, async (req, res, next) => {
  try {
    const { actor, action, resourceId, limit = 100, offset = 0 } = req.query;
    const rows = await auditService.query({
      actor: actor || undefined,
      action: action || undefined,
      resourceId: resourceId || undefined,
      limit: Math.min(parseInt(limit, 10) || 100, 500),
      offset: Math.max(parseInt(offset, 10) || 0, 0),
    });

    res.json({
      success: true,
      data: rows,
      pagination: {
        limit: Math.min(parseInt(limit, 10) || 100, 500),
        offset: Math.max(parseInt(offset, 10) || 0, 0),
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

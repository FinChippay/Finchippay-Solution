"use strict";

const express = require("express");
const { performBackup, restoreBackup, listBackups } = require("../../services/backupService");
const { sendError } = require("../../utils/errorResponse");

const router = express.Router();

// Middleware placeholder for admin auth guard (if req.user role is admin)
function requireAdmin(req, res, next) {
  if (req.user && req.user.role && req.user.role !== "admin") {
    return sendError(res, "AUTH_FORBIDDEN", { message: "Admin access required" });
  }
  next();
}

router.use(requireAdmin);

/**
 * GET /api/v1/admin/backups
 * List all available backups
 */
router.get("/backups", (req, res) => {
  try {
    const backups = listBackups();
    res.json({ backups });
  } catch (err) {
    sendError(res, "SRV_INTERNAL", { details: { reason: err.message } });
  }
});

/**
 * POST /api/v1/admin/backup
 * Trigger manual backup
 */
router.post("/backup", async (req, res) => {
  try {
    const result = await performBackup();
    res.json(result);
  } catch (err) {
    sendError(res, "SRV_INTERNAL", { details: { reason: err.message } });
  }
});

/**
 * POST /api/v1/admin/restore
 * Restore database from a backup file
 */
router.post("/restore", async (req, res) => {
  try {
    const { filename } = req.body || {};
    if (!filename) {
      return sendError(res, "VAL_MISSING_FIELD", {
        message: "filename is required",
        details: { field: "filename" },
      });
    }
    const result = await restoreBackup(filename);
    res.json(result);
  } catch (err) {
    sendError(res, "SRV_INTERNAL", { details: { reason: err.message } });
  }
});

module.exports = router;

/**
 * src/routes/admin/backup.js
 * Admin-only backup management routes.
 *
 * Mounted at: /api/admin
 * All routes require a valid JWT from an allowlisted Stellar account
 * (verifyJWT + requireAdmin — see src/middleware/auth.js).
 */

"use strict";

const express = require("express");
const { verifyJWT, requireAdmin } = require("../../middleware/auth");
const { performBackup, restoreBackup, listBackups } = require("../../services/backupService");
const { verifyLatestBackup } = require("../../services/backupVerificationService");

const router = express.Router();

// Every route in this router is admin-only.
router.use(verifyJWT, requireAdmin);

/**
 * GET /api/admin/backups
 * List all available backups.
 */
router.get("/backups", (req, res) => {
  try {
    const backups = listBackups();
    res.json({ backups });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/admin/backup
 * Trigger a manual backup now.
 */
router.post("/backup", async (req, res) => {
  try {
    const result = await performBackup();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/admin/backup/verify
 * Restore the latest backup into a throwaway database, apply migrations, and
 * run integrity checks (orphaned foreign keys, balance consistency, table row
 * counts). Returns a report with `success: false` when the backup restored but
 * integrity checks found violations — the CRITICAL log + Prometheus gauge
 * (backup_verification_success) are the alerting mechanism.
 */
router.post("/backup/verify", async (req, res) => {
  try {
    const result = await verifyLatestBackup();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/admin/restore
 * Restore the production database from a backup file.
 */
router.post("/restore", async (req, res) => {
  try {
    const { filename } = req.body || {};
    if (!filename) {
      return res.status(400).json({ error: "filename is required" });
    }
    const result = await restoreBackup(filename);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

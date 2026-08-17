/**
 * src/routes/payments.js
 * Payment history and logging endpoints.
 */

"use strict";

const express = require("express");
const router = express.Router();
const { strictLimiter } = require("../middleware/rateLimit");
const { userLimiter } = require("../middleware/userRateLimit");
const { sanitizePublicKey } = require("../middleware/sanitization");
const { validate } = require("../validation/middleware");
const { publicKeyParamSchema, paymentsQuerySchema } = require("../validation/schemas");
const paymentController = require("../controllers/paymentController");
const { csvUploadMiddleware } = require("../middleware/csvUpload");
const Papa = require("papaparse");
const logger = require("../utils/logger");
const { sendError } = require("../utils/errorResponse");

/**
 * GET /api/payments/:publicKey
 * Fetch payment history for an account via Horizon.
 *
 * Query params:
 *   limit  — number of results (default: 20, max: 100)
 *   cursor — pagination cursor
 */
router.get(
  "/:publicKey",
  strictLimiter,
  userLimiter,
  sanitizePublicKey,
  validate(publicKeyParamSchema, "params"),
  validate(paymentsQuerySchema, "query"),
  paymentController.getPayments,
);

/**
 * GET /api/payments/:publicKey/stats
 * Return aggregate stats for an account (total sent, received, count).
 */
router.get(
  "/:publicKey/stats",
  strictLimiter,
  userLimiter,
  validate(publicKeyParamSchema, "params"),
  paymentController.getStats,
);

/**
 * POST /api/payments/batch/upload
 * Upload a CSV file for batch payment processing.
 * Uses multer for streaming file upload (configurable via CSV_UPLOAD_MAX_SIZE).
 * Parses CSV with papaparse and returns parsed rows.
 */
router.post(
  "/batch/upload",
  strictLimiter,
  userLimiter,
  csvUploadMiddleware,
  async (req, res, next) => {
    try {
      if (!req.file) {
        return sendError(res, "VAL_MISSING_FIELD", {
          message: "No CSV file uploaded",
          details: { field: "file" },
        });
      }

      const csvBuffer = req.file.buffer.toString("utf-8");

      Papa.parse(csvBuffer, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          if (!results.data || results.data.length === 0) {
            return sendError(res, "VAL_MISSING_FIELD", {
              message: "CSV file is empty or has no data rows",
              details: { field: "file" },
            });
          }

          res.json({
            rows: results.data,
            total: results.data.length,
            fileName: req.file.originalname,
            fileSize: req.file.size,
          });
        },
        error: (parseError) => {
          logger.error({ err: parseError }, "CSV parsing failed");
          sendError(res, "VAL_INVALID_JSON", {
            message: "CSV parsing failed",
            details: { reason: parseError.message },
          });
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

module.exports = router;

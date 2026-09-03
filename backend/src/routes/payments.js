/**
 * src/routes/payments.js
 * Payment history and logging endpoints.
 */

"use strict";

const express = require("express");
const router = express.Router();
const { verifyJWT } = require("../middleware/auth");
const { formatErrorResponse, ERROR_CODES } = require("../../../shared/errorCodes");
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
 * Reject a route whose `:publicKey` path param differs from the authenticated
 * account (WS1). The JWT is the source of truth for authorization; a caller
 * may only query payment history for their own account.
 */
function requireOwnPublicKey(req, res, next) {
  if (req.user?.publicKey !== req.params.publicKey) {
    return res.status(ERROR_CODES.AUTH_FORBIDDEN.httpStatus).json(
      formatErrorResponse("AUTH_FORBIDDEN", {
        message: "Forbidden: you may only access your own payment history.",
      }),
    );
  }
  return next();
}

// Per-upload row cap so a malicious CSV cannot force unbounded parsing
// memory/CPU per request (WS6).
const MAX_CSV_ROWS = parseInt(process.env.MAX_CSV_ROWS, 10) || 500;

const sanitizeFileName = (name) => {
  if (!name) return "upload.csv";
  return (
    name
      // eslint-disable-next-line no-control-regex
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, "")
      .replace(/&[a-zA-Z0-9#]+;/g, "")
      .trim() || "upload.csv"
  );
};

const validateCsvRows = (rows) => {
  const errors = [];
  rows.forEach((row, index) => {
    const recipient = row.recipient || row.to;
    if (!recipient) {
      errors.push({ row: index + 1, error: "Missing recipient/to column" });
    }
    const amount = parseFloat(row.amount);
    if (isNaN(amount) || amount <= 0) {
      errors.push({ row: index + 1, error: "Invalid or missing amount" });
    }
    if (!row.asset) {
      errors.push({ row: index + 1, error: "Missing asset column" });
    }
  });
  return errors;
};

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
  verifyJWT,
  requireOwnPublicKey,
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
  verifyJWT,
  requireOwnPublicKey,
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
        return sendError(res, "VAL_MISSING_FIELD", { message: "No CSV file uploaded" });
      }

      const csvBuffer = req.file.buffer.toString("utf-8");

      Papa.parse(csvBuffer, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          if (!results.data || results.data.length === 0) {
            return sendError(res, "VAL_MISSING_FIELD", {
              message: "CSV file is empty or has no data rows",
            });
          }

          if (results.data.length > MAX_CSV_ROWS) {
            return sendError(res, "VAL_TOO_MANY_ROWS", {
              message: `CSV exceeds the maximum of ${MAX_CSV_ROWS} rows`,
              details: { maxRows: MAX_CSV_ROWS, received: results.data.length },
            });
          }

          const validationErrors = validateCsvRows(results.data);
          if (validationErrors.length > 0) {
            return sendError(res, "VAL_INVALID_JSON", {
              message: "CSV validation failed",
              details: { errors: validationErrors },
            });
          }

          res.json({
            rows: results.data,
            total: results.data.length,
            fileName: sanitizeFileName(req.file.originalname),
            fileSize: req.file.size,
          });
        },
        error: (parseError) => {
          logger.error({ err: parseError }, "CSV parsing failed");
          return sendError(res, "VAL_INVALID_JSON", {
            message: `CSV parsing failed: ${parseError.message}`,
          });
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

module.exports = router;

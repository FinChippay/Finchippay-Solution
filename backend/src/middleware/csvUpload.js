/**
 * src/middleware/csvUpload.js
 * Streaming CSV upload middleware using multer.
 *
 * Handles multipart/form-data CSV file uploads for batch payment imports.
 * Files are stored in memory for processing with papaparse.
 * File size limit is configurable via CSV_UPLOAD_MAX_SIZE env var (default: 10MB).
 */

"use strict";

const multer = require("multer");

const CSV_UPLOAD_MAX_SIZE = parseInt(process.env.CSV_UPLOAD_MAX_SIZE, 10) || 10 * 1024 * 1024; // 10MB default

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: CSV_UPLOAD_MAX_SIZE,
  },
  fileFilter: (_req, file, cb) => {
    if (
      file.mimetype === "text/csv" ||
      file.mimetype === "application/vnd.ms-excel" ||
      file.originalname.endsWith(".csv")
    ) {
      cb(null, true);
    } else {
      cb(new Error("Only CSV files are allowed"), false);
    }
  },
});

/**
 * Middleware that handles single CSV file upload under the field name "csvFile".
 */
const csvUploadMiddleware = upload.single("csvFile");

module.exports = { csvUploadMiddleware, CSV_UPLOAD_MAX_SIZE };

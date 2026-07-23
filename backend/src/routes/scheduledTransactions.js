/**
 * src/routes/scheduledTransactions.js
 * Routes for scheduling future Stellar transaction submissions.
 */

"use strict";

const express = require("express");
const router = express.Router();
const scheduledTransactionService = require("../services/scheduledTransactionService");
const { formatErrorResponse, ERROR_CODES } = require("../../../shared/errorCodes");

/**
 * POST /api/scheduled-txns
 * Schedules a new transaction for future submission.
 * Body: { signedXDR: string, submitAt: string (ISO 8601), publicKey: string }
 */
router.post("/", (req, res, next) => {
  try {
    const { signedXDR, submitAt, publicKey } = req.body;

    if (!signedXDR || !submitAt || !publicKey) {
      return res
        .status(ERROR_CODES.VAL_MISSING_FIELD.httpStatus)
        .json(formatErrorResponse("VAL_MISSING_FIELD", { fields: ["signedXDR", "submitAt", "publicKey"] }));
    }

    const submitDate = new Date(submitAt);
    if (isNaN(submitDate.getTime())) {
      return res
        .status(ERROR_CODES.VAL_INVALID_DATE.httpStatus)
        .json(formatErrorResponse("VAL_INVALID_DATE"));
    }

    const scheduledTx = scheduledTransactionService.scheduleTransaction(
      signedXDR,
      submitDate,
      publicKey
    );
    res.status(201).json({
      message: "Transaction scheduled successfully",
      id: scheduledTx.id,
      publicKey: scheduledTx.publicKey,
      submitAt: new Date(scheduledTx.submitAt).toISOString(),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/scheduled-txns/:publicKey
 * Lists all pending scheduled transactions for a given public key.
 */
router.get("/:publicKey", (req, res, next) => {
  try {
    const { publicKey } = req.params;
    const transactions = scheduledTransactionService.getPendingTransactions(
      publicKey
    );
    res.json(transactions);
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /api/scheduled-txns/:id
 * Cancels a scheduled transaction.
 */
router.delete("/:id", (req, res, next) => {
  try {
    const { id } = req.params;
    const cancelled = scheduledTransactionService.cancelTransaction(id);
    if (cancelled) {
      res.json({ message: `Transaction ${id} cancelled successfully.` });
    } else {
      res
        .status(ERROR_CODES.RES_NOT_FOUND.httpStatus)
        .json(formatErrorResponse("RES_NOT_FOUND", { resourceType: "scheduledTransaction", id }));
    }
  } catch (error) {
    next(error);
  }
});

module.exports = router;

/**
 * src/routes/scheduledTransactions.js
 * Routes for scheduling future Stellar transaction submissions.
 */

"use strict";

const express = require("express");
const router = express.Router();
const scheduledTransactionService = require("../services/scheduledTransactionService");
const { validate } = require("../validation/middleware");
const {
  scheduleTransactionSchema,
  loosePublicKeyParamSchema,
  idParamSchema,
} = require("../validation/schemas");

/**
 * POST /api/scheduled-txns
 * Schedules a new transaction for future submission.
 * Body: { signedXDR: string, submitAt: string (ISO 8601), publicKey: string }
 */
router.post("/", validate(scheduleTransactionSchema), (req, res, next) => {
  try {
    // submitAt is already confirmed to parse to a valid date by the schema.
    const { signedXDR, submitAt, publicKey } = req.validated;

    const scheduledTx = scheduledTransactionService.scheduleTransaction(
      signedXDR,
      new Date(submitAt),
      publicKey,
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
router.get(
  "/:publicKey",
  validate(loosePublicKeyParamSchema, "params"),
  (req, res, next) => {
    try {
      const { publicKey } = req.validated;
      const transactions =
        scheduledTransactionService.getPendingTransactions(publicKey);
      res.json(transactions);
    } catch (error) {
      next(error);
    }
  },
);

/**
 * DELETE /api/scheduled-txns/:id
 * Cancels a scheduled transaction.
 */
router.delete("/:id", validate(idParamSchema, "params"), (req, res, next) => {
  try {
    const { id } = req.validated;
    const cancelled = scheduledTransactionService.cancelTransaction(id);
    if (cancelled) {
      res.json({ message: `Transaction ${id} cancelled successfully.` });
    } else {
      res
        .status(404)
        .json({ error: `Transaction ${id} not found or not pending.` });
    }
  } catch (error) {
    next(error);
  }
});

module.exports = router;

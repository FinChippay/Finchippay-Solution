/**
 * src/routes/scheduledTransactions.js
 * CRUD + execution routes for cron-based scheduled Stellar transactions.
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

 160-issue-38-rtl-language-support-arabic-hebrew-fix
/**
 * POST /api/scheduled-txns
 * Schedules a new transaction for future submission.
 * Body: { signedXDR: string, submitAt: string (ISO 8601), publicKey: string }
 */
router.post("/", validate(scheduleTransactionSchema), (req, res, next) => {
  try {
    // submitAt is already confirmed to parse to a valid date by the schema.
    const { signedXDR, submitAt, publicKey } = req.validated;

// POST /api/scheduled-transactions
router.post("/", (req, res, next) => {
  try {
    const { signedXDR, submitAt, publicKey } = req.body;

    if (!signedXDR || !submitAt || !publicKey) {
      return res
        .status(400)
        .json({ error: "Missing signedXDR, submitAt, or publicKey" });
    }

    const submitDate = new Date(submitAt);
    if (isNaN(submitDate.getTime())) {
      return res
        .status(400)
        .json({ error: "submitAt must be a valid ISO 8601 date string" });
    const schedule = scheduledTransactionService.createSchedule(req.body);
    res.status(201).json(schedule);
  } catch (error) {
    next(error);
  }
});
 master

// POST /api/scheduled-transactions/pending/:id/submit
router.post("/pending/:id/submit", async (req, res, next) => {
  try {
    const { signedXDR } = req.body;
    if (!signedXDR) {
      return res
        .status(ERROR_CODES.VAL_MISSING_FIELD.httpStatus)
        .json(formatErrorResponse("VAL_MISSING_FIELD", { fields: ["signedXDR"] }));
    }
    const result = await scheduledTransactionService.submitPendingExecution(
      req.params.id,
      signedXDR,
 160-issue-38-rtl-language-support-arabic-hebrew-fix
      new Date(submitAt),
      publicKey,

 master
    );
    res.json(result);
  } catch (error) {
    next(error);
  }
});

 160-issue-38-rtl-language-support-arabic-hebrew-fix
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

// GET /api/scheduled-transactions/:publicKey/pending
router.get("/:publicKey/pending", (req, res, next) => {
  try {
    const pending = scheduledTransactionService.listPendingExecutions(req.params.publicKey);
    res.json(pending);
  } catch (error) {
    next(error);
  }
});

// GET /api/scheduled-transactions/:publicKey
router.get("/:publicKey", (req, res, next) => {
  try {
    const schedules = scheduledTransactionService.listSchedules(req.params.publicKey);
    res.json(schedules);
  } catch (error) {
    next(error);
  }
});

// PUT /api/scheduled-transactions/:id
router.put("/:id", (req, res, next) => {
  try {
    const updated = scheduledTransactionService.updateSchedule(req.params.id, req.body);
    res.json(updated);
  } catch (error) {
    next(error);
  }
});

// DELETE /api/scheduled-transactions/:id
router.delete("/:id", (req, res, next) => {
  try {
    const deleted = scheduledTransactionService.deleteSchedule(req.params.id);
    if (deleted) {
      res.json({ message: `Scheduled transaction ${req.params.id} deleted.` });
    } else {
      res
        .status(ERROR_CODES.RES_NOT_FOUND.httpStatus)
        .json(
          formatErrorResponse("RES_NOT_FOUND", {
            resourceType: "scheduledTransaction",
            id: req.params.id,
          }),
        );
 master
    }
  } catch (error) {
    next(error);
  }
});

module.exports = router;
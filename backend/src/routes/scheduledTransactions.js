/**
 * src/routes/scheduledTransactions.js
 * CRUD + execution routes for cron-based scheduled Stellar transactions.
 */
"use strict";
const express = require("express");
const router = express.Router();
const scheduledTransactionService = require("../services/scheduledTransactionService");
const { formatErrorResponse, ERROR_CODES } = require("../../../shared/errorCodes");

// POST /api/scheduled-transactions
router.post("/", (req, res, next) => {
  try {
    const schedule = scheduledTransactionService.createSchedule(req.body);
    res.status(201).json(schedule);
  } catch (error) {
    next(error);
  }
});

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
    );
    res.json(result);
  } catch (error) {
    next(error);
  }
});

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
    }
  } catch (error) {
    next(error);
  }
});

module.exports = router;
/**
 * src/routes/scheduledTransactions.js
 * CRUD + execution routes for cron-based scheduled Stellar transactions.
 */

"use strict";

const express = require("express");
const router = express.Router();
const scheduledTransactionService = require("../services/scheduledTransactionService");
const scheduledExecutor = require("../services/scheduledExecutor");
const { validate } = require("../validation/middleware");
const {
  scheduleTransactionSchema,
  loosePublicKeyParamSchema,
  idParamSchema,
} = require("../validation/schemas");
const { formatErrorResponse, ERROR_CODES } = require("../../../shared/errorCodes");

/**
 * POST /api/scheduled-transactions
 * Schedules a new transaction for future submission.
 * Body: { signedXDR: string, submitAt: string (ISO 8601), publicKey: string }
 */
router.post("/", validate(scheduleTransactionSchema), async (req, res, next) => {
  try {
    const { signedXDR, submitAt, publicKey } = req.validated;
    const schedule = await scheduledTransactionService.createSchedule({
      signedXDR,
      submitAt: new Date(submitAt),
      publicKey,
    });
    res.status(201).json(schedule);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/scheduled-transactions/pending/:id/submit
 * Submits a pending execution.
 *
 * Validation: the id comes from req.validated (idParamSchema enforces a
 * non-empty string). Service treats it as opaque.
 */
router.post("/pending/:id/submit", validate(idParamSchema, "params"), async (req, res, next) => {
  try {
    const { id } = req.validated;
    const { signedXDR } = req.body;
    if (!signedXDR) {
      return res
        .status(ERROR_CODES.VAL_MISSING_FIELD.httpStatus)
        .json(formatErrorResponse("VAL_MISSING_FIELD", { fields: ["signedXDR"] }));
    }
    const result = await scheduledTransactionService.submitPendingExecution(id, signedXDR);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/scheduled-transactions/:publicKey/pending
 * Lists pending executions for a given public key.
 */
router.get("/:publicKey/pending", async (req, res, next) => {
  try {
    const pending = await scheduledTransactionService.listPendingExecutions(req.params.publicKey);
    res.json(pending);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/scheduled-transactions/:publicKey
 * Lists all schedules for a given public key.
 */
router.get("/:publicKey", validate(loosePublicKeyParamSchema, "params"), async (req, res, next) => {
  try {
    const { publicKey } = req.validated;
    const schedules = await scheduledTransactionService.listSchedules(publicKey);
    res.json(schedules);
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /api/scheduled-transactions/:id
 * Updates an existing scheduled transaction.
 *
 * Validation: the id comes from req.validated (idParamSchema enforces a
 * non-empty string), so the service can treat it as opaque.
 */
router.put("/:id", validate(idParamSchema, "params"), async (req, res, next) => {
  try {
    const { id } = req.validated;
    const updated = await scheduledTransactionService.updateSchedule(id, req.body);
    res.json(updated);
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /api/scheduled-transactions/:id
 * Deletes or cancels a scheduled transaction by ID.
 */
router.delete("/:id", validate(idParamSchema, "params"), async (req, res, next) => {
  try {
    const { id } = req.validated;
    const deleted = await scheduledTransactionService.deleteSchedule(id);
    if (deleted) {
      res.json({ message: `Scheduled transaction ${id} deleted.` });
    } else {
      res.status(ERROR_CODES.RES_NOT_FOUND.httpStatus).json(
        formatErrorResponse("RES_NOT_FOUND", {
          resourceType: "scheduledTransaction",
          id,
        }),
      );
    }
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/scheduled-transactions/:id/execute-now
 * Manually trigger immediate execution of a scheduled transaction,
 * regardless of its scheduled time.
 */
router.post("/:id/execute-now", validate(idParamSchema, "params"), async (req, res, next) => {
  try {
    const { id } = req.validated;
    const result = await scheduledExecutor.executeNow(id);
    res.status(result.success ? 200 : 202).json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/scheduled-transactions/:id/executions
 * Get execution history for a scheduled transaction.
 * Shows all execution attempts, retries, and failures.
 */
router.get("/:id/executions", validate(idParamSchema, "params"), async (req, res, next) => {
  try {
    const { id } = req.validated;
    const executions = await scheduledExecutor.getExecutionHistory(id);
    res.json({ scheduleId: id, executions });
  } catch (error) {
    next(error);
  }
});

module.exports = router;

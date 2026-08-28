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
const {
  paginateInMemory,
  setPaginationHeaders,
  formatPaginatedResponse,
} = require("../utils/paginate");
const { verifyJWT } = require("../middleware/auth");
const { sensitiveLimiter } = require("../middleware/rateLimit");
const { userLimiter } = require("../middleware/userRateLimit");

/**
 * Restrict scheduled-transaction routes to the authenticated account holder.
 * Runs after verifyJWT (which sets req.user.publicKey from the SEP-10 JWT).
 */
function requireOwnSchedule(req, res, next) {
  if (req.user?.publicKey !== req.params.publicKey) {
    return res
      .status(ERROR_CODES.AUTH_FORBIDDEN.httpStatus)
      .json(formatErrorResponse("AUTH_FORBIDDEN", {
        message: "Forbidden: you may only access your own scheduled transactions.",
      }));
  }
  next();
}

/**
 * Restrict schedule-by-ID routes to the schedule owner.
 * Fetches the schedule and verifies ownership.
 */
async function requireScheduleOwner(req, res, next) {
  try {
    const schedule = await scheduledTransactionService.getScheduleById(req.params.id);
    if (!schedule) {
      return res
        .status(ERROR_CODES.RES_NOT_FOUND.httpStatus)
        .json(formatErrorResponse("RES_NOT_FOUND", {
          resourceType: "scheduledTransaction",
          id: req.params.id,
        }));
    }
    if (req.user?.publicKey !== schedule.owner_pk) {
      return res
        .status(ERROR_CODES.AUTH_FORBIDDEN.httpStatus)
        .json(formatErrorResponse("AUTH_FORBIDDEN", {
          message: "Forbidden: you may only access your own scheduled transactions.",
        }));
    }
    req.schedule = schedule;
    next();
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/scheduled-transactions
 * Schedules a new transaction for future submission.
 * Body: { signedXDR: string, submitAt: string (ISO 8601), publicKey?: string }
 * The owner is derived from the authenticated user's JWT.
 * If publicKey is provided, it must match the authenticated user's publicKey.
 */
router.post("/", sensitiveLimiter, userLimiter, verifyJWT, validate(scheduleTransactionSchema), async (req, res, next) => {
  try {
    const { signedXDR, submitAt, publicKey } = req.validated;
    if (publicKey && publicKey !== req.user.publicKey) {
      return res
        .status(ERROR_CODES.AUTH_FORBIDDEN.httpStatus)
        .json(formatErrorResponse("AUTH_FORBIDDEN", {
          message: "Forbidden: publicKey in body must match authenticated user.",
        }));
    }
    const schedule = await scheduledTransactionService.createSchedule({
      signedXDR,
      submitAt: new Date(submitAt),
      ownerPk: req.user.publicKey,
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
router.post("/pending/:id/submit", sensitiveLimiter, userLimiter, verifyJWT, validate(idParamSchema, "params"), async (req, res, next) => {
  try {
    const { id } = req.validated;
    const { signedXDR } = req.body;
    if (!signedXDR) {
      return res
        .status(ERROR_CODES.VAL_MISSING_FIELD.httpStatus)
        .json(formatErrorResponse("VAL_MISSING_FIELD", { fields: ["signedXDR"] }));
    }
    // Verify the pending execution belongs to the authenticated user
    const pending = await scheduledTransactionService.getPendingExecutionById(id);
    if (!pending) {
      return res
        .status(ERROR_CODES.RES_NOT_FOUND.httpStatus)
        .json(formatErrorResponse("RES_NOT_FOUND", {
          resourceType: "pendingExecution",
          id,
        }));
    }
    if (req.user.publicKey !== pending.owner_pk) {
      return res
        .status(ERROR_CODES.AUTH_FORBIDDEN.httpStatus)
        .json(formatErrorResponse("AUTH_FORBIDDEN", {
          message: "Forbidden: you may only submit your own pending executions.",
        }));
    }
    const result = await scheduledTransactionService.submitPendingExecution(id, signedXDR);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/scheduled-transactions/:publicKey/pending
 * Lists pending executions for a given public key with standardized pagination.
 */
router.get("/:publicKey/pending", sensitiveLimiter, userLimiter, verifyJWT, requireOwnSchedule, async (req, res, next) => {
  try {
    const rawPending = await scheduledTransactionService.listPendingExecutions(
      req.params.publicKey,
    );
    const limit = req.pagination?.limit || Math.min(parseInt(req.query.limit) || 20, 100);
    const cursor = req.pagination?.cursor || null;

    const { data, nextCursor, total } = paginateInMemory(
      rawPending || [],
      { limit, cursor },
      (p) => ({ id: p.id }),
      (a, b) => String(b.id || "").localeCompare(String(a.id || "")),
    );

    setPaginationHeaders(req, res, { nextCursor, total, limit });
    res.json(formatPaginatedResponse(data, nextCursor, total, { limit }));
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/scheduled-transactions/:publicKey
 * Lists all schedules for a given public key with standardized pagination.
 */
router.get("/:publicKey", sensitiveLimiter, userLimiter, verifyJWT, requireOwnSchedule, validate(loosePublicKeyParamSchema, "params"), async (req, res, next) => {
  try {
    const { publicKey } = req.validated;
    const rawSchedules = await scheduledTransactionService.listSchedules(publicKey);
    const limit = req.pagination?.limit || Math.min(parseInt(req.query.limit) || 20, 100);
    const cursor = req.pagination?.cursor || null;

    const { data, nextCursor, total } = paginateInMemory(
      rawSchedules || [],
      { limit, cursor },
      (s) => ({ id: s.id }),
      (a, b) => String(b.id || "").localeCompare(String(a.id || "")),
    );

    setPaginationHeaders(req, res, { nextCursor, total, limit });
    res.json(formatPaginatedResponse(data, nextCursor, total, { limit }));
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
router.put("/:id", sensitiveLimiter, userLimiter, verifyJWT, requireScheduleOwner, validate(idParamSchema, "params"), async (req, res, next) => {
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
router.delete("/:id", sensitiveLimiter, userLimiter, verifyJWT, requireScheduleOwner, validate(idParamSchema, "params"), async (req, res, next) => {
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
router.post("/:id/execute-now", sensitiveLimiter, userLimiter, verifyJWT, requireScheduleOwner, validate(idParamSchema, "params"), async (req, res, next) => {
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
router.get("/:id/executions", sensitiveLimiter, userLimiter, verifyJWT, requireScheduleOwner, validate(idParamSchema, "params"), async (req, res, next) => {
  try {
    const { id } = req.validated;
    const executions = await scheduledExecutor.getExecutionHistory(id);
    res.json({ scheduleId: id, executions });
  } catch (error) {
    next(error);
  }
});

module.exports = router;

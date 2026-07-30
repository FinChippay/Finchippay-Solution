/**
 * src/services/scheduledExecutor.js
 *
 * Automatic execution engine for scheduled transactions.
 *
 * Runs every 60 seconds (configurable), queries due scheduled transactions,
 * and submits them to Stellar. Implements retry logic: 3 attempts with
 * 5-minute intervals for failed submissions. After final failure, marks
 * transaction as failed and triggers failure notification.
 *
 * Execution history is logged to scheduled_txn_executions table for audit.
 */

"use strict";

const crypto = require("crypto");
const { TransactionBuilder } = require("@stellar/stellar-sdk");

const knex = require("../db/connection");
const logger = require("../utils/logger");
const scheduledTransactionService = require("./scheduledTransactionService");
const webhookService = require("./webhookService");

// Configuration
const EXECUTOR_INTERVAL_MS = process.env.SCHEDULED_EXECUTOR_INTERVAL_MS || 60_000; // 60 seconds
const MAX_RETRIES = process.env.SCHEDULED_TX_MAX_RETRIES || 3;
const RETRY_INTERVAL_MS = process.env.SCHEDULED_TX_RETRY_INTERVAL_MS || 5 * 60 * 1000; // 5 minutes
const EXECUTION_WINDOW_MS = 60_000; // Execute transactions within ±60 seconds of scheduled time

let executorTimer = null;
let isRunning = false;

// ─── Helper Functions ────────────────────────────────────────────────────────

/**
 * Parse error response from Stellar Horizon.
 * @param {Error} err - The thrown error from server.submitTransaction()
 * @returns {object} { code, message, statusCode }
 */
function parseHorizonError(err) {
  if (err.response?.data?.extras?.result_codes) {
    const resultCodes = err.response.data.extras.result_codes;
    return {
      code: resultCodes.transaction || "UNKNOWN_ERROR",
      message: err.message,
      statusCode: err.response.status,
    };
  }

  // Network or timeout errors
  if (err.code === "ECONNREFUSED" || err.code === "ENOTFOUND") {
    return { code: "NETWORK_ERROR", message: err.message, statusCode: 0 };
  }

  if (err.message?.includes("timeout")) {
    return { code: "TIMEOUT", message: err.message, statusCode: 0 };
  }

  return {
    code: "SUBMISSION_ERROR",
    message: err.message,
    statusCode: err.response?.status || 0,
  };
}

/**
 * Determine if error is retryable (network issues, timeouts) vs permanent (bad signature, insufficient funds).
 * @param {string} errorCode - Parsed error code from Horizon response
 * @returns {boolean} true if the error is retryable
 */
function isRetryableError(errorCode) {
  // Permanent failures — don't retry
  const permanentErrors = [
    "tx_failed",
    "tx_too_early",
    "tx_too_late",
    "tx_missing_operation",
    "tx_missing_memo",
    "tx_duplicate",
    "tx_insufficient_fee",
    "op_underfunded",
    "op_malformed",
    "op_invalid_account",
  ];

  return !permanentErrors.includes(errorCode);
}

/**
 * Get all scheduled transactions due for execution.
 * Returns transactions whose next_run_at is within the execution window.
 * @returns {Promise<Array>} Array of due scheduled transaction records
 */
async function getDueTransactions() {
  const now = new Date();
  const windowStart = new Date(now.getTime() - EXECUTION_WINDOW_MS);
  const windowEnd = new Date(now.getTime() + EXECUTION_WINDOW_MS);

  const dueTransactions = await knex("scheduled_transactions")
    .where("status", "active")
    .andWhereBetween("next_run_at", [windowStart, windowEnd])
    .orderBy("next_run_at", "asc");

  return dueTransactions;
}

/**
 * Get pending retries (failed executions not yet resolved).
 * Returns executions due for retry based on next_retry_at.
 * @returns {Promise<Array>} Array of retry-due execution records
 */
async function getPendingRetries() {
  const now = new Date();
  const pendingRetries = await knex("scheduled_txn_executions")
    .where("status", "pending")
    .andWhere("attempt_number", "<", MAX_RETRIES + 1)
    .andWhere((builder) => {
      builder.whereNull("next_retry_at").orWhere("next_retry_at", "<=", now);
    })
    .orderBy("next_retry_at", "asc")
    .limit(50); // Process up to 50 retries per cycle

  return pendingRetries;
}

/**
 * Build and submit a scheduled transaction to Stellar.
 * @param {object} schedule - Scheduled transaction record from DB
 * @returns {Promise<object>} { success: boolean, hash?: string, error?: object }
 */
async function submitScheduledTransaction(schedule) {
  try {
    // Rebuild the unsigned XDR
    const xdr = await scheduledTransactionService.buildUnsignedPaymentXDR({
      ownerPk: schedule.owner_pk,
      recipient: schedule.recipient,
      amount: schedule.amount,
      asset: schedule.asset,
      memo: schedule.memo,
    });

    // Convert XDR string to transaction object
    TransactionBuilder.fromXDR(
      xdr,
      process.env.STELLAR_NETWORK === "mainnet"
        ? require("@stellar/stellar-sdk").Networks.PUBLIC
        : require("@stellar/stellar-sdk").Networks.TESTNET,
    );

    // Submit to Horizon — this assumes the transaction is already signed by the owner
    // (which doesn't happen automatically in the current design).
    // For now, we log this as the proposed flow but need owner signing.
    // TODO: This requires revisiting the architecture — either:
    //   1. Pre-sign transactions with a backend signer key (requires trust)
    //   2. Queue execution and wait for user signature (current flow)
    //   3. Use multisig with a backend recovery signer

    // For MVP, we'll log that submission is pending owner signature
    logger.warn(
      { scheduleId: schedule.id, recipient: schedule.recipient },
      "Scheduled transaction queued for owner signature submission",
    );

    return {
      success: false,
      error: {
        code: "AWAITING_SIGNATURE",
        message: "Transaction queued; awaiting owner signature via webhook",
      },
    };
  } catch (err) {
    const errorInfo = parseHorizonError(err);
    logger.error(
      { scheduleId: schedule.id, error: errorInfo },
      "Failed to submit scheduled transaction",
    );
    return {
      success: false,
      error: errorInfo,
    };
  }
}

/**
 * Log execution attempt to execution history table.
 * @param {object} params - { scheduleId, ownerId, status, attemptNumber, hash, error, errorCode }
 * @returns {Promise<object>} Execution record created
 */
async function logExecution({
  scheduleId,
  ownerId,
  status,
  attemptNumber,
  hash,
  errorMessage,
  errorCode,
  nextRetryAt,
}) {
  const executionId = crypto.randomUUID();

  await knex("scheduled_txn_executions").insert({
    id: executionId,
    schedule_id: scheduleId,
    owner_pk: ownerId,
    status,
    attempt_number: attemptNumber,
    submitted_hash: hash || null,
    error_message: errorMessage || null,
    error_code: errorCode || null,
    next_retry_at: nextRetryAt || null,
    resolved_at: status === "submitted" || status === "failed" ? new Date() : null,
  });

  return { id: executionId, status };
}

/**
 * Notify owner of transaction failure via webhook.
 * @param {object} schedule - Scheduled transaction record
 * @param {object} execution - Execution history record
 */
async function notifyFailure(schedule, execution) {
  try {
    const hooks = await webhookService.getWebhooksByPublicKey(schedule.owner_pk);

    const payload = {
      event: "scheduled_transaction.failed",
      scheduleId: schedule.id,
      executionId: execution.id,
      recipient: schedule.recipient,
      amount: schedule.amount,
      asset: schedule.asset,
      memo: schedule.memo,
      attemptNumber: execution.attempt_number,
      maxRetries: MAX_RETRIES,
      errorCode: execution.error_code,
      errorMessage: execution.error_message,
      executedAt: execution.executed_at,
    };

    await Promise.allSettled(
      hooks.map((h) => webhookService.deliverWebhook(h, payload)),
    );

    logger.info(
      { scheduleId: schedule.id, hooks: hooks.length },
      "Sent failure notification webhooks",
    );
  } catch (err) {
    logger.error(
      { scheduleId: schedule.id, err },
      "Failed to send failure notification",
    );
  }
}

/**
 * Handle a due transaction: submit it or queue for retry.
 * @param {object} schedule - Scheduled transaction record
 */
async function executeDueTransaction(schedule) {
  logger.debug(
    { scheduleId: schedule.id, recipient: schedule.recipient },
    "Executing due scheduled transaction",
  );

  const result = await submitScheduledTransaction(schedule);

  if (result.success) {
    // Success: log and update schedule
    await logExecution({
      scheduleId: schedule.id,
      ownerId: schedule.owner_pk,
      status: "submitted",
      attemptNumber: 1,
      hash: result.hash,
    });

    // Update next run time for recurring schedules
    const nextRun = scheduledTransactionService.estimateNextRun(
      schedule.frequency,
      new Date(),
    );
    if (nextRun) {
      await knex("scheduled_transactions")
        .where("id", schedule.id)
        .update({ next_run_at: nextRun });
    }

    logger.info(
      { scheduleId: schedule.id, hash: result.hash },
      "Scheduled transaction submitted successfully",
    );
  } else {
    // Failure: determine if retryable
    const errorCode = result.error?.code;
    const isRetryable = isRetryableError(errorCode);

    if (isRetryable) {
      // Queue for retry
      const nextRetryAt = new Date(Date.now() + RETRY_INTERVAL_MS);
      await logExecution({
        scheduleId: schedule.id,
        ownerId: schedule.owner_pk,
        status: "pending",
        attemptNumber: 1,
        errorMessage: result.error?.message,
        errorCode,
        nextRetryAt,
      });

      logger.info(
        { scheduleId: schedule.id, nextRetry: nextRetryAt, error: errorCode },
        "Scheduled transaction queued for retry",
      );
    } else {
      // Permanent failure: mark as failed and notify
      const execution = await logExecution({
        scheduleId: schedule.id,
        ownerId: schedule.owner_pk,
        status: "failed",
        attemptNumber: 1,
        errorMessage: result.error?.message,
        errorCode,
      });

      await knex("scheduled_transactions")
        .where("id", schedule.id)
        .update({ status: "failed" });

      await notifyFailure(schedule, execution);

      logger.warn(
        { scheduleId: schedule.id, error: errorCode },
        "Scheduled transaction failed permanently after first attempt",
      );
    }
  }
}

/**
 * Handle a pending retry: re-submit failed transaction.
 * @param {object} execution - Execution history record
 */
async function handleRetry(execution) {
  const schedule = await knex("scheduled_transactions")
    .where("id", execution.schedule_id)
    .first();

  if (!schedule) {
    logger.warn(
      { executionId: execution.id },
      "Scheduled transaction not found for retry",
    );
    return;
  }

  logger.debug(
    { scheduleId: schedule.id, attempt: execution.attempt_number + 1 },
    "Retrying scheduled transaction",
  );

  const result = await submitScheduledTransaction(schedule);

  if (result.success) {
    // Success on retry
    await knex("scheduled_txn_executions")
      .where("id", execution.id)
      .update({
        status: "submitted",
        submitted_hash: result.hash,
        resolved_at: new Date(),
      });

    // Update schedule next run
    const nextRun = scheduledTransactionService.estimateNextRun(
      schedule.frequency,
      new Date(),
    );
    if (nextRun) {
      await knex("scheduled_transactions")
        .where("id", schedule.id)
        .update({ next_run_at: nextRun });
    }

    logger.info(
      { scheduleId: schedule.id, hash: result.hash, attempt: execution.attempt_number + 1 },
      "Scheduled transaction succeeded on retry",
    );
  } else {
    // Still failing
    const errorCode = result.error?.code;
    const isRetryable = isRetryableError(errorCode);
    const nextAttempt = execution.attempt_number + 1;

    if (isRetryable && nextAttempt < MAX_RETRIES) {
      // Queue next retry
      const nextRetryAt = new Date(Date.now() + RETRY_INTERVAL_MS);
      await knex("scheduled_txn_executions")
        .where("id", execution.id)
        .update({
          attempt_number: nextAttempt,
          error_message: result.error?.message,
          error_code: errorCode,
          next_retry_at: nextRetryAt,
        });

      logger.info(
        { scheduleId: schedule.id, attempt: nextAttempt, nextRetry: nextRetryAt },
        "Scheduled transaction queued for next retry",
      );
    } else {
      // Final failure
      await knex("scheduled_txn_executions")
        .where("id", execution.id)
        .update({
          status: "failed",
          attempt_number: nextAttempt,
          error_message: result.error?.message,
          error_code: errorCode,
          resolved_at: new Date(),
        });

      await knex("scheduled_transactions")
        .where("id", schedule.id)
        .update({ status: "failed" });

      await notifyFailure(schedule, {
        ...execution,
        attempt_number: nextAttempt,
        error_code: errorCode,
        error_message: result.error?.message,
      });

      logger.warn(
        { scheduleId: schedule.id, finalAttempt: nextAttempt, error: errorCode },
        "Scheduled transaction failed permanently after all retries",
      );
    }
  }
}

/**
 * Main executor cycle: process due transactions and pending retries.
 */
async function executeCycle() {
  if (isRunning) {
    logger.debug("Executor cycle already running; skipping");
    return;
  }

  isRunning = true;
  const cycleStart = Date.now();

  try {
    logger.debug("Starting scheduled executor cycle");

    // Process due transactions
    const dueTransactions = await getDueTransactions();
    if (dueTransactions.length > 0) {
      logger.info({ count: dueTransactions.length }, "Processing due scheduled transactions");
      for (const schedule of dueTransactions) {
        try {
          await executeDueTransaction(schedule);
        } catch (err) {
          logger.error(
            { scheduleId: schedule.id, err },
            "Error executing due transaction",
          );
        }
      }
    }

    // Process pending retries
    const pendingRetries = await getPendingRetries();
    if (pendingRetries.length > 0) {
      logger.info({ count: pendingRetries.length }, "Processing pending retries");
      for (const execution of pendingRetries) {
        try {
          await handleRetry(execution);
        } catch (err) {
          logger.error(
            { executionId: execution.id, err },
            "Error handling retry",
          );
        }
      }
    }

    const cycleDuration = Date.now() - cycleStart;
    logger.debug(
      { dueCount: dueTransactions.length, retryCount: pendingRetries.length, durationMs: cycleDuration },
      "Executor cycle completed",
    );
  } catch (err) {
    logger.error({ err }, "Scheduled executor cycle failed");
  } finally {
    isRunning = false;
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Start the scheduled executor.
 * Runs every EXECUTOR_INTERVAL_MS (60 seconds by default).
 */
function start() {
  if (executorTimer) {
    logger.warn("Scheduled executor already running");
    return;
  }

  logger.info(
    { intervalMs: EXECUTOR_INTERVAL_MS, maxRetries: MAX_RETRIES, retryIntervalMs: RETRY_INTERVAL_MS },
    "Starting scheduled executor",
  );

  // Run immediately on startup
  executeCycle().catch((err) => {
    logger.error({ err }, "Initial executor cycle failed");
  });

  // Then run on interval
  executorTimer = setInterval(() => {
    executeCycle().catch((err) => {
      logger.error({ err }, "Executor cycle error" );
    });
  }, EXECUTOR_INTERVAL_MS);
}

/**
 * Stop the scheduled executor.
 */
function stop() {
  if (executorTimer) {
    clearInterval(executorTimer);
    executorTimer = null;
    logger.info("Scheduled executor stopped");
  }
}

/**
 * Whether the executor's polling interval is currently active (i.e. start()
 * has been called and stop() has not). Distinct from the `isRunning` module
 * variable above, which tracks whether a single cycle is in flight right now.
 * Used by the startup probe to confirm boot completed.
 * @returns {boolean}
 */
function isStarted() {
  return !!executorTimer;
}

/**
 * Manually trigger a scheduled transaction for immediate execution.
 * @param {string} scheduleId - The scheduled transaction ID
 * @returns {Promise<object>} Execution result
 */
async function executeNow(scheduleId) {
  const schedule = await knex("scheduled_transactions")
    .where("id", scheduleId)
    .first();

  if (!schedule) {
    const err = new Error("Scheduled transaction not found");
    err.status = 404;
    throw err;
  }

  logger.info(
    { scheduleId, recipient: schedule.recipient },
    "Manual immediate execution triggered",
  );

  const result = await submitScheduledTransaction(schedule);

  const execution = await logExecution({
    scheduleId: schedule.id,
    ownerId: schedule.owner_pk,
    status: result.success ? "submitted" : "pending",
    attemptNumber: 1,
    hash: result.success ? result.hash : null,
    errorMessage: result.error?.message,
    errorCode: result.error?.code,
    nextRetryAt: !result.success && isRetryableError(result.error?.code)
      ? new Date(Date.now() + RETRY_INTERVAL_MS)
      : null,
  });

  return {
    success: result.success,
    executionId: execution.id,
    hash: result.hash,
    error: result.error,
  };
}

/**
 * Get execution history for a scheduled transaction.
 * @param {string} scheduleId - The scheduled transaction ID
 * @returns {Promise<Array>} Execution history records
 */
async function getExecutionHistory(scheduleId) {
  const history = await knex("scheduled_txn_executions")
    .where("schedule_id", scheduleId)
    .orderBy("executed_at", "desc");

  return history;
}

module.exports = {
  start,
  stop,
  isStarted,
  executeNow,
  getExecutionHistory,
};

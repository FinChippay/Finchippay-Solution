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
 *
 * Single-execution guarantee (#632):
 *  - Before any side effect runs, the worker atomically claims the execution
 *    (a Redis SET NX PX distributed lock plus a durable `execution_status =
 *    'claimed'` row with a `lease_expires_at` lease). Exactly one worker can
 *    own a claim at a time.
 *  - If a worker crashes mid-execution, its lease expires and another worker
 *    reclaims and completes the execution instead of silently dropping it.
 *  - Due-but-unclaimed runs from missed ticks are swept up on every cycle
 *    (and on startup), so a skipped tick is caught up rather than lost.
 */

"use strict";

const crypto = require("crypto");
const { TransactionBuilder } = require("@stellar/stellar-sdk");

const knex = require("../db/connection");
const logger = require("../utils/logger");
const scheduledTransactionService = require("./scheduledTransactionService");
const webhookService = require("./webhookService");
const tracer = require("../config/tracing").getTracer("scheduler");

// Configuration
const EXECUTOR_INTERVAL_MS = process.env.SCHEDULED_EXECUTOR_INTERVAL_MS || 60_000; // 60 seconds
const MAX_RETRIES = process.env.SCHEDULED_TX_MAX_RETRIES || 3;
const RETRY_INTERVAL_MS = process.env.SCHEDULED_TX_RETRY_INTERVAL_MS || 5 * 60 * 1000; // 5 minutes
const EXECUTION_LEASE_MS = parseInt(process.env.SCHEDULED_EXECUTION_LEASE_MS || "120000", 10); // 2 minutes

const LOCK_KEY_PREFIX = "scheduled_execution:lock:";

const EXECUTION_STATUS = Object.freeze({
  CLAIMED: "claimed",
  EXECUTED: "executed",
  FAILED: "failed",
});

let executorTimer = null;
let isRunning = false;

// â”€â”€â”€ Helper Functions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
  // Permanent failures â€” don't retry
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
 * Determine if a database error is a unique/primary-key constraint violation,
 * used to detect that another worker already inserted the execution claim.
 * @param {Error} err
 * @returns {boolean}
 */
function isUniqueViolation(err) {
  if (!err) return false;
  const code = err.code || (err.cause && err.cause.code);
  if (
    code === "23505" ||
    code === "SQLITE_CONSTRAINT" ||
    code === "SQLITE_CONSTRAINT_UNIQUE" ||
    code === "SQLITE_CONSTRAINT_PRIMARYKEY"
  ) {
    return true;
  }
  return /unique constraint/i.test(err.message || "");
}

/**
 * Derive a deterministic execution id for a schedule's current run.
 *
 * Using the schedule id + its `next_run_at` (which only advances after a
 * successful run) means every worker that races to execute the same due run
 * computes the *same* execution id. The first worker's INSERT wins; everyone
 * else hits a primary-key collision and backs off.
 *
 * @param {object} schedule - Scheduled transaction record from DB
 * @returns {string}
 */
function executionIdForRun(schedule) {
  const runAt = schedule.next_run_at ? new Date(schedule.next_run_at).getTime() : Date.now();
  return `${schedule.id}:${runAt}`;
}

// â”€â”€â”€ Redis distributed lock (ioredis, only when REDIS_URL is set) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

let lockRedis = null;

function getLockRedis() {
  if (lockRedis) return lockRedis;
  if (!process.env.REDIS_URL) return null;
  try {
    const { Redis } = require("ioredis");
    lockRedis = new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: 2,
      enableOfflineQueue: false,
    });
    lockRedis.on("error", (err) => {
      logger.warn({ err }, "Scheduled executor lock Redis client error");
    });
  } catch (err) {
    logger.warn({ err }, "Failed to initialise scheduled executor lock Redis client");
    return null;
  }
  return lockRedis;
}

/**
 * Acquire a distributed lock using SET NX PX.
 * @param {string} key - Lock key
 * @param {number} ttlMs - Lock TTL in milliseconds
 * @returns {Promise<"acquired"|"held"|"unavailable">} "acquired" when this
 *   worker owns the lock, "held" when another worker owns it, or "unavailable"
 *   when Redis is not configured/reachable (caller falls back to the DB claim).
 */
async function acquireLock(key, ttlMs) {
  const redis = getLockRedis();
  if (!redis) return "unavailable";
  try {
    const result = await redis.set(key, "1", "PX", ttlMs, "NX");
    return result === "OK" ? "acquired" : "held";
  } catch (err) {
    logger.warn({ err, key }, "Redis lock acquire failed â€” falling back to DB claim");
    return "unavailable";
  }
}

/**
 * Release a distributed lock (best effort).
 * @param {string} key - Lock key
 */
async function releaseLock(key) {
  const redis = getLockRedis();
  if (!redis) return;
  try {
    await redis.del(key);
  } catch (err) {
    logger.warn({ err, key }, "Redis lock release failed");
  }
}

// â”€â”€â”€ Claim / lease management â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Claim a brand-new execution so only one worker runs its side effect.
 *
 * The claim is keyed by the deterministic execution id for the schedule's run;
 * concurrent workers compute the same id and race on a single INSERT. The
 * first worker's INSERT wins; everyone else hits a primary-key collision and
 * backs off. A Redis SET NX PX lock (when available) is used as a fast
 * distributed gate before touching the database.
 *
 * @param {string} executionId - Deterministic execution id for the run
 * @param {object} schedule - Scheduled transaction record from DB
 * @returns {Promise<{executionId:string, lockKey:string, leaseExpiresAt:Date}|null>}
 */
async function claimExecution(executionId, schedule) {
  const lockKey = `${LOCK_KEY_PREFIX}${executionId}`;
  const leaseExpiresAt = new Date(Date.now() + EXECUTION_LEASE_MS);

  const lockResult = await acquireLock(lockKey, EXECUTION_LEASE_MS);
  if (lockResult === "held") {
    logger.debug(
      { executionId, scheduleId: schedule.id },
      "Execution already locked by another worker",
    );
    return null;
  }

  try {
    await knex("scheduled_txn_executions").insert({
      id: executionId,
      schedule_id: schedule.id,
      owner_pk: schedule.owner_pk,
      status: "pending",
      attempt_number: 1,
      execution_status: EXECUTION_STATUS.CLAIMED,
      lease_expires_at: leaseExpiresAt,
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      if (lockResult === "acquired") await releaseLock(lockKey);
      logger.debug({ executionId, scheduleId: schedule.id }, "Execution already claimed; skipping");
      return null;
    }
    if (lockResult === "acquired") await releaseLock(lockKey);
    throw err;
  }

  return { executionId, lockKey, leaseExpiresAt };
}

/**
 * Re-claim an existing pending execution for a retry attempt, or recover a
 * claim left behind by a crashed worker whose lease has expired.
 *
 * The UPDATE is guarded so only one concurrent worker flips the row from
 * "unclaimed"/"expired" back to "claimed" (the others affect 0 rows).
 *
 * @param {string} executionId - Execution id of the pending execution
 * @param {object} schedule - Scheduled transaction record from DB
 * @returns {Promise<{executionId:string, lockKey:string, leaseExpiresAt:Date}|null>}
 */
async function claimRetry(executionId, schedule) {
  const lockKey = `${LOCK_KEY_PREFIX}${executionId}`;
  const leaseExpiresAt = new Date(Date.now() + EXECUTION_LEASE_MS);

  const lockResult = await acquireLock(lockKey, EXECUTION_LEASE_MS);
  if (lockResult === "held") {
    logger.debug(
      { executionId, scheduleId: schedule.id },
      "Retry already locked by another worker",
    );
    return null;
  }

  const updated = await knex("scheduled_txn_executions")
    .where("id", executionId)
    .andWhere("status", "pending")
    .andWhere(function (builder) {
      builder.whereNull("execution_status").orWhere(function (inner) {
        inner.where("execution_status", EXECUTION_STATUS.CLAIMED).andWhere(function (lease) {
          lease.whereNull("lease_expires_at").orWhere("lease_expires_at", "<=", new Date());
        });
      });
    })
    .update({
      execution_status: EXECUTION_STATUS.CLAIMED,
      lease_expires_at: leaseExpiresAt,
    });

  if (updated !== 1) {
    if (lockResult === "acquired") await releaseLock(lockKey);
    logger.debug({ executionId, scheduleId: schedule.id }, "Retry already claimed; skipping");
    return null;
  }

  return { executionId, lockKey, leaseExpiresAt };
}

/**
 * Mark a claimed execution as resolved and release its lease + lock.
 * @param {object} claim - Claim returned by claimExecution()
 * @param {object} updates - Column updates to apply (status, execution_status, â€¦)
 */
async function finalizeClaim(claim, updates) {
  await knex("scheduled_txn_executions")
    .where("id", claim.executionId)
    .update({ ...updates, lease_expires_at: null });
  await releaseLock(claim.lockKey);
}

// â”€â”€â”€ Due / retry discovery â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Get all scheduled transactions due for execution, including missed runs.
 *
 * A schedule is "due" when its next_run_at is now or in the past â€” the old
 * Â±60s window silently dropped runs whenever a tick was missed, so we sweep
 * everything overdue instead. Schedules that already have an unresolved
 * (pending) execution are excluded: those are handled by the retry sweep.
 *
 * @returns {Promise<Array>} Array of due scheduled transaction records
 */
async function getDueTransactions() {
  const now = new Date();

  const dueTransactions = await knex("scheduled_transactions as st")
    .where("st.status", "active")
    .andWhere("st.next_run_at", "<=", now)
    .whereNotExists(function () {
      this.select(knex.raw("1"))
        .from("scheduled_txn_executions as ex")
        .whereRaw("ex.schedule_id = st.id")
        .andWhere("ex.status", "pending");
    })
    .orderBy("st.next_run_at", "asc");

  return dueTransactions;
}

/**
 * Get pending retries (failed executions not yet resolved).
 * Returns executions due for retry based on next_retry_at, including crashed
 * claims whose lease has expired.
 *
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
    .andWhere((builder) => {
      builder.whereNull("execution_status").orWhere("lease_expires_at", "<=", now);
    })
    .orderBy("next_retry_at", "asc")
    .limit(50); // Process up to 50 retries per cycle

  return pendingRetries;
}

// â”€â”€â”€ Submission â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

    // ARCHITECTURE NOTE: Scheduled transaction execution design (resolved in v3.1):
    //   1. Transactions are built unsigned and queued for owner signing via webhook notification.
    //   2. The owner receives a webhook payload and signs via Freighter/Albedo/Ledger.
    //   3. The signed XDR is submitted back to the API, which submits to Horizon.
    //   4. For future: multisig with a backend recovery signer using SEP-30.
    // See docs/architecture.md Â§ Scheduled Transactions for the full design.

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
 * Log execution attempt to execution history table (used by the manual
 * execute-now path, which is not part of the auto-execution claim flow).
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

    await Promise.allSettled(hooks.map((h) => webhookService.deliverWebhook(h, payload)));

    logger.info(
      { scheduleId: schedule.id, hooks: hooks.length },
      "Sent failure notification webhooks",
    );
  } catch (err) {
    logger.error({ scheduleId: schedule.id, err }, "Failed to send failure notification");
  }
}

/**
 * Advance a schedule's next_run_at after a successful run.
 * @param {object} schedule - Scheduled transaction record
 */
async function advanceSchedule(schedule) {
  const nextRun = scheduledTransactionService.estimateNextRun(schedule.frequency, new Date());
  if (nextRun) {
    await knex("scheduled_transactions").where("id", schedule.id).update({ next_run_at: nextRun });
  }
}

/**
 * Handle a due transaction: claim it, then submit it or queue for retry.
 * @param {object} schedule - Scheduled transaction record
 */
async function executeDueTransactionImpl(schedule) {
  const executionId = executionIdForRun(schedule);
  const claim = await claimExecution(executionId, schedule);
  if (!claim) {
    logger.debug({ scheduleId: schedule.id }, "Skipping already-claimed due transaction");
    return;
  }

  logger.debug(
    { scheduleId: schedule.id, recipient: schedule.recipient, executionId },
    "Executing due scheduled transaction",
  );

  const result = await submitScheduledTransaction(schedule);

  if (result.success) {
    // Success: resolve and update schedule
    await finalizeClaim(claim, {
      status: "submitted",
      execution_status: EXECUTION_STATUS.EXECUTED,
      submitted_hash: result.hash,
      resolved_at: new Date(),
    });

    await advanceSchedule(schedule);

    logger.info(
      { scheduleId: schedule.id, hash: result.hash },
      "Scheduled transaction submitted successfully",
    );
  } else {
    // Failure: determine if retryable
    const errorCode = result.error?.code;
    const isRetryable = isRetryableError(errorCode);

    if (isRetryable) {
      // Queue for retry (release the claim so the retry sweep can re-claim it)
      const nextRetryAt = new Date(Date.now() + RETRY_INTERVAL_MS);
      await finalizeClaim(claim, {
        status: "pending",
        execution_status: null,
        attempt_number: 1,
        error_message: result.error?.message,
        error_code: errorCode,
        next_retry_at: nextRetryAt,
      });

      logger.info(
        { scheduleId: schedule.id, nextRetry: nextRetryAt, error: errorCode },
        "Scheduled transaction queued for retry",
      );
    } else {
      // Permanent failure: mark as failed and notify
      await finalizeClaim(claim, {
        status: "failed",
        execution_status: EXECUTION_STATUS.FAILED,
        attempt_number: 1,
        error_message: result.error?.message,
        error_code: errorCode,
        resolved_at: new Date(),
      });

      await knex("scheduled_transactions").where("id", schedule.id).update({ status: "failed" });

      await notifyFailure(schedule, {
        id: claim.executionId,
        attempt_number: 1,
        error_code: errorCode,
        error_message: result.error?.message,
        executed_at: new Date(),
      });

      logger.warn(
        { scheduleId: schedule.id, error: errorCode },
        "Scheduled transaction failed permanently after first attempt",
      );
    }
  }
}

/**
 * Handle a pending retry: re-claim and re-submit a failed transaction.
 * @param {object} execution - Execution history record
 */
async function executeDueTransaction(schedule) {
  const span = tracer.startSpan("scheduler.execute_due_transaction", {
    attributes: { "schedule.id": schedule.id, "schedule.recipient": schedule.recipient },
  });
  try {
    return await executeDueTransactionImpl(schedule);
  } catch (err) {
    span.recordException(err);
    throw err;
  } finally {
    span.end();
  }
}

async function handleRetry(execution) {
  const schedule = await knex("scheduled_transactions").where("id", execution.schedule_id).first();

  if (!schedule) {
    logger.warn({ executionId: execution.id }, "Scheduled transaction not found for retry");
    return;
  }

  const claim = await claimRetry(execution.id, schedule);
  if (!claim) {
    logger.debug({ executionId: execution.id }, "Skipping already-claimed retry");
    return;
  }

  logger.debug(
    { scheduleId: schedule.id, attempt: execution.attempt_number + 1 },
    "Retrying scheduled transaction",
  );

  const result = await submitScheduledTransaction(schedule);

  if (result.success) {
    // Success on retry
    await finalizeClaim(claim, {
      status: "submitted",
      execution_status: EXECUTION_STATUS.EXECUTED,
      submitted_hash: result.hash,
      resolved_at: new Date(),
    });

    await advanceSchedule(schedule);

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
      await finalizeClaim(claim, {
        status: "pending",
        execution_status: null,
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
      await finalizeClaim(claim, {
        status: "failed",
        execution_status: EXECUTION_STATUS.FAILED,
        attempt_number: nextAttempt,
        error_message: result.error?.message,
        error_code: errorCode,
        resolved_at: new Date(),
      });

      await knex("scheduled_transactions").where("id", schedule.id).update({ status: "failed" });

      await notifyFailure(schedule, {
        ...execution,
        id: claim.executionId,
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

    // Process due transactions (including missed-run catch-up)
    const dueTransactions = await getDueTransactions();
    if (dueTransactions.length > 0) {
      logger.info({ count: dueTransactions.length }, "Processing due scheduled transactions");
      for (const schedule of dueTransactions) {
        try {
          await executeDueTransaction(schedule);
        } catch (err) {
          logger.error({ scheduleId: schedule.id, err }, "Error executing due transaction");
        }
      }
    }

    // Process pending retries (including reclaiming crashed claims)
    const pendingRetries = await getPendingRetries();
    if (pendingRetries.length > 0) {
      logger.info({ count: pendingRetries.length }, "Processing pending retries");
      for (const execution of pendingRetries) {
        try {
          await handleRetry(execution);
        } catch (err) {
          logger.error({ executionId: execution.id, err }, "Error handling retry");
        }
      }
    }

    const cycleDuration = Date.now() - cycleStart;
    logger.debug(
      {
        dueCount: dueTransactions.length,
        retryCount: pendingRetries.length,
        durationMs: cycleDuration,
      },
      "Executor cycle completed",
    );
  } catch (err) {
    logger.error({ err }, "Scheduled executor cycle failed");
  } finally {
    isRunning = false;
  }
}

// â”€â”€â”€ Public API â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
    {
      intervalMs: EXECUTOR_INTERVAL_MS,
      maxRetries: MAX_RETRIES,
      retryIntervalMs: RETRY_INTERVAL_MS,
      executionLeaseMs: EXECUTION_LEASE_MS,
    },
    "Starting scheduled executor",
  );

  // Run immediately on startup (also catches up missed runs)
  executeCycle().catch((err) => {
    logger.error({ err }, "Initial executor cycle failed");
  });

  // Then run on interval
  executorTimer = setInterval(() => {
    executeCycle().catch((err) => {
      logger.error({ err }, "Executor cycle error");
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
  const schedule = await knex("scheduled_transactions").where("id", scheduleId).first();

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
    nextRetryAt:
      !result.success && isRetryableError(result.error?.code)
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
  // Exported for testing (#632)
  claimExecution,
  claimRetry,
  finalizeClaim,
  executeDueTransaction,
  handleRetry,
  getDueTransactions,
  getPendingRetries,
  executionIdForRun,
};



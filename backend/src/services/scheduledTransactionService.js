/**
 * src/services/scheduledTransactionService.js
 *
 * Scheduled Stellar transactions: cron-based execution that produces an
 * unsigned XDR and waits for the owner to sign via Freighter. The signed
 * transaction is then submitted to Horizon.
 *
 * Storage: Knex (SQLite in development, PostgreSQL in production). The
 * earlier version of this file used better-sqlite3 prepared statements
 * directly; the migration to Knex was incomplete, so this rewrite unifies
 * every read/write through the shared `knex` query builder.
 */

"use strict";

const crypto = require("crypto");
const cron = require("node-cron");

const {
  Asset,
  Memo,
  Networks,
  Operation,
  TransactionBuilder,
} = require("@stellar/stellar-sdk");

const knex = require("../db/connection");
const { server } = require("../config/stellar");
const { validatePublicKey } = require("./stellarService");
const webhookService = require("./webhookService");
const logger = require("../utils/logger");

const NETWORK_PASSPHRASE =
  process.env.STELLAR_NETWORK === "mainnet" ? Networks.PUBLIC : Networks.TESTNET;

// scheduleId -> node-cron task handle
const activeCronJobs = new Map();

// ─── Helpers ──────────────────────────────────────────────────────────────

function toAsset(assetStr) {
  if (!assetStr || assetStr === "XLM") return Asset.native();
  const [code, issuer] = assetStr.split(":");
  if (!code || !issuer) {
    const err = new Error("Non-XLM asset must be formatted as CODE:ISSUER");
    err.status = 400;
    throw err;
  }
  return new Asset(code, issuer);
}

function frequencyToCron(frequency, startDate, cronExpression) {
  if (frequency === "cron") {
    if (!cronExpression || !cron.validate(cronExpression)) {
      const err = new Error(
        "A valid cron_expression is required when frequency is 'cron'",
      );
      err.status = 400;
      throw err;
    }
    return cronExpression;
  }

  const d = new Date(startDate);
  if (isNaN(d.getTime())) {
    const err = new Error("startDate must be a valid date");
    err.status = 400;
    throw err;
  }
  const minute = d.getUTCMinutes();
  const hour = d.getUTCHours();

  if (frequency === "daily") return `${minute} ${hour} * * *`;
  if (frequency === "weekly") return `${minute} ${hour} * * ${d.getUTCDay()}`;
  if (frequency === "monthly") return `${minute} ${hour} ${d.getUTCDate()} * *`;

  const err = new Error(
    "frequency must be 'daily', 'weekly', 'monthly', or 'cron'",
  );
  err.status = 400;
  throw err;
}

function estimateNextRun(frequency, fromDate) {
  const next = new Date(fromDate);
  if (frequency === "daily") next.setUTCDate(next.getUTCDate() + 1);
  else if (frequency === "weekly") next.setUTCDate(next.getUTCDate() + 7);
  else if (frequency === "monthly")
    next.setUTCMonth(next.getUTCMonth() + 1);
  else return null; // raw cron: fired by node-cron directly, not tracked here
  return next.toISOString();
}

async function buildUnsignedPaymentXDR({
  ownerPk,
  recipient,
  amount,
  asset,
  memo,
}) {
  const sourceAccount = await server.loadAccount(ownerPk);
  const assetObj = toAsset(asset);

  const builder = new TransactionBuilder(sourceAccount, {
    fee: "100",
    networkPassphrase: NETWORK_PASSPHRASE,
  }).addOperation(
    Operation.payment({
      destination: recipient,
      asset: assetObj,
      amount: String(amount),
    }),
  );

  if (memo) builder.addMemo(Memo.text(memo));

  const tx = builder.setTimeout(3600).build();
  return tx.toXDR();
}

// ─── Cron registry ────────────────────────────────────────────────────────

function registerCronJob(schedule) {
  unregisterCronJob(schedule.id);
  const task = cron.schedule(
    schedule.cron_expression,
    () => executeSchedule(schedule.id),
    { timezone: "UTC" },
  );
  activeCronJobs.set(schedule.id, task);
}

function unregisterCronJob(id) {
  const task = activeCronJobs.get(id);
  if (task) {
    task.stop();
    activeCronJobs.delete(id);
  }
}

async function loadActiveSchedules() {
  const rows = await knex("scheduled_transactions").where("status", "active");
  for (const schedule of rows) {
    registerCronJob(schedule);
  }
  logger.info({ count: rows.length }, "Loaded active scheduled transactions");
}

// ─── Execution ────────────────────────────────────────────────────────────

async function notifyOwner(schedule, pendingId) {
  const hooks = await webhookService.getWebhooksByPublicKey(
    schedule.owner_pk,
  );
  const payload = {
    event: "scheduled_transaction.pending_signature",
    scheduleId: schedule.id,
    pendingExecutionId: pendingId,
    recipient: schedule.recipient,
    amount: schedule.amount,
    asset: schedule.asset,
  };
  await Promise.allSettled(
    hooks.map((h) => webhookService.deliverWebhook(h, payload)),
  );
}

async function executeSchedule(scheduleId) {
  const schedule = await knex("scheduled_transactions")
    .where("id", scheduleId)
    .andWhere("status", "active")
    .first();
  if (!schedule) return;

  try {
    const xdr = await buildUnsignedPaymentXDR({
      ownerPk: schedule.owner_pk,
      recipient: schedule.recipient,
      amount: schedule.amount,
      asset: schedule.asset,
      memo: schedule.memo,
    });

    const pendingId = crypto.randomUUID();
    await knex("pending_executions").insert({
      id: pendingId,
      schedule_id: schedule.id,
      owner_pk: schedule.owner_pk,
      unsigned_xdr: xdr,
      status: "awaiting_signature",
    });

    await notifyOwner(schedule, pendingId);

    const nextRun = estimateNextRun(schedule.frequency, new Date());
    await knex("scheduled_transactions")
      .where("id", schedule.id)
      .update({ next_run_at: nextRun });
  } catch (err) {
    logger.error(
      { err, scheduleId },
      "Failed to execute scheduled transaction",
    );
  }
}

// ─── CRUD ─────────────────────────────────────────────────────────────────

async function createSchedule(body) {
  const {
    ownerPk,
    recipient,
    amount,
    asset = "XLM",
    memo,
    frequency,
    cronExpression,
    startDate,
  } = body;

  if (!ownerPk || !recipient || !amount || !frequency || !startDate) {
    const err = new Error(
      "ownerPk, recipient, amount, frequency, and startDate are required",
    );
    err.status = 400;
    throw err;
  }
  validatePublicKey(ownerPk);
  validatePublicKey(recipient);

  const resolvedCron = frequencyToCron(frequency, startDate, cronExpression);
  const id = crypto.randomUUID();
  const nextRunAt = estimateNextRun(frequency, new Date(startDate)) || startDate;

  await knex("scheduled_transactions").insert({
    id,
    owner_pk: ownerPk,
    recipient,
    amount: String(amount),
    asset,
    memo: memo || null,
    frequency,
    cron_expression: resolvedCron,
    start_date: startDate,
    next_run_at: nextRunAt,
    status: "active",
  });

  const schedule = await knex("scheduled_transactions")
    .where("id", id)
    .first();
  registerCronJob(schedule);
  return schedule;
}

async function listSchedules(ownerPk) {
  validatePublicKey(ownerPk);
  return knex("scheduled_transactions")
    .where("owner_pk", ownerPk)
    .orderBy("created_at", "desc");
}

async function updateSchedule(id, updates) {
  const existing = await knex("scheduled_transactions")
    .where("id", id)
    .first();
  if (!existing) {
    const err = new Error("Scheduled transaction not found");
    err.status = 404;
    throw err;
  }

  const merged = { ...existing, ...updates };
  const resolvedCron =
    updates.frequency || updates.cronExpression
      ? frequencyToCron(
          merged.frequency,
          merged.start_date,
          updates.cronExpression || merged.cron_expression,
        )
      : existing.cron_expression;

  await knex("scheduled_transactions").where("id", id).update({
    recipient: merged.recipient,
    amount: String(merged.amount),
    asset: merged.asset,
    memo: merged.memo || null,
    frequency: merged.frequency,
    cron_expression: resolvedCron,
    status: merged.status,
  });

  const updated = await knex("scheduled_transactions")
    .where("id", id)
    .first();

  if (updated.status === "active") {
    registerCronJob(updated);
  } else {
    unregisterCronJob(id);
  }

  return updated;
}

async function deleteSchedule(id) {
  const existing = await knex("scheduled_transactions")
    .where("id", id)
    .first();
  if (!existing) return false;
  unregisterCronJob(id);
  await knex("scheduled_transactions").where("id", id).del();
  return true;
}

async function listPendingExecutions(ownerPk) {
  validatePublicKey(ownerPk);
  return knex("pending_executions as pe")
    .join(
      "scheduled_transactions as st",
      "st.id",
      "pe.schedule_id",
    )
    .where("pe.owner_pk", ownerPk)
    .andWhere("pe.status", "awaiting_signature")
    .orderBy("pe.created_at", "desc")
    .select("pe.*", "st.recipient", "st.amount", "st.asset");
}

async function submitPendingExecution(id, signedXDR) {
  const pending = await knex("pending_executions")
    .where("id", id)
    .first();
  if (!pending) {
    const err = new Error("Pending execution not found");
    err.status = 404;
    throw err;
  }
  if (pending.status !== "awaiting_signature") {
    const err = new Error(`Pending execution is already ${pending.status}`);
    err.status = 409;
    throw err;
  }

  try {
    const tx = TransactionBuilder.fromXDR(signedXDR, NETWORK_PASSPHRASE);
    const result = await server.submitTransaction(tx);
    await knex("pending_executions").where("id", id).update({
      status: "submitted",
      submitted_hash: result.hash,
      resolved_at: new Date().toISOString(),
    });
    return { status: "submitted", hash: result.hash };
  } catch (err) {
    await knex("pending_executions").where("id", id).update({
      status: "failed",
      error: err.message,
      resolved_at: new Date().toISOString(),
    });
    const wrapped = new Error(`Submission failed: ${err.message}`);
    wrapped.status = 400;
    throw wrapped;
  }
}

module.exports = {
  createSchedule,
  listSchedules,
  updateSchedule,
  deleteSchedule,
  listPendingExecutions,
  submitPendingExecution,
  loadActiveSchedules,
};

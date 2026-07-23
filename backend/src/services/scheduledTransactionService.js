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

const db = require("../db");
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
      const err = new Error("A valid cron_expression is required when frequency is 'cron'");
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

  const err = new Error("frequency must be 'daily', 'weekly', 'monthly', or 'cron'");
  err.status = 400;
  throw err;
}

function estimateNextRun(frequency, fromDate) {
  const next = new Date(fromDate);
  if (frequency === "daily") next.setUTCDate(next.getUTCDate() + 1);
  else if (frequency === "weekly") next.setUTCDate(next.getUTCDate() + 7);
  else if (frequency === "monthly") next.setUTCMonth(next.getUTCMonth() + 1);
  else return null; // raw cron: fired by node-cron directly, not tracked here
  return next.toISOString();
}

async function buildUnsignedPaymentXDR({ ownerPk, recipient, amount, asset, memo }) {
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

function loadActiveSchedules() {
  const rows = db.prepare("SELECT * FROM scheduled_transactions WHERE status = 'active'").all();
  for (const schedule of rows) {
    registerCronJob(schedule);
  }
  logger.info({ count: rows.length }, "Loaded active scheduled transactions");
}

// ─── Execution ────────────────────────────────────────────────────────────

async function notifyOwner(schedule, pendingId) {
  const hooks = webhookService.getWebhooksByPublicKey(schedule.owner_pk);
  const payload = {
    event: "scheduled_transaction.pending_signature",
    scheduleId: schedule.id,
    pendingExecutionId: pendingId,
    recipient: schedule.recipient,
    amount: schedule.amount,
    asset: schedule.asset,
  };
  await Promise.allSettled(hooks.map((h) => webhookService.deliverWebhook(h, payload)));
}

async function executeSchedule(scheduleId) {
  const schedule = db
    .prepare("SELECT * FROM scheduled_transactions WHERE id = ? AND status = 'active'")
    .get(scheduleId);
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
    db.prepare(
      `INSERT INTO pending_executions (id, schedule_id, owner_pk, unsigned_xdr, status)
       VALUES (?, ?, ?, ?, 'awaiting_signature')`,
    ).run(pendingId, schedule.id, schedule.owner_pk, xdr);

    await notifyOwner(schedule, pendingId);

    const nextRun = estimateNextRun(schedule.frequency, new Date());
    db.prepare("UPDATE scheduled_transactions SET next_run_at = ? WHERE id = ?").run(
      nextRun,
      schedule.id,
    );
  } catch (err) {
    logger.error({ err, scheduleId }, "Failed to execute scheduled transaction");
  }
}

// ─── CRUD ─────────────────────────────────────────────────────────────────

function createSchedule(body) {
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
    const err = new Error("ownerPk, recipient, amount, frequency, and startDate are required");
    err.status = 400;
    throw err;
  }
  validatePublicKey(ownerPk);
  validatePublicKey(recipient);

  const resolvedCron = frequencyToCron(frequency, startDate, cronExpression);
  const id = crypto.randomUUID();
  const nextRunAt = estimateNextRun(frequency, new Date(startDate)) || startDate;

  db.prepare(
    `INSERT INTO scheduled_transactions
      (id, owner_pk, recipient, amount, asset, memo, frequency, cron_expression, start_date, next_run_at, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
  ).run(
    id,
    ownerPk,
    recipient,
    String(amount),
    asset,
    memo || null,
    frequency,
    resolvedCron,
    startDate,
    nextRunAt,
  );

  const schedule = db.prepare("SELECT * FROM scheduled_transactions WHERE id = ?").get(id);
  registerCronJob(schedule);
  return schedule;
}

function listSchedules(ownerPk) {
  validatePublicKey(ownerPk);
  return db
    .prepare("SELECT * FROM scheduled_transactions WHERE owner_pk = ? ORDER BY created_at DESC")
    .all(ownerPk);
}

function updateSchedule(id, updates) {
  const existing = db.prepare("SELECT * FROM scheduled_transactions WHERE id = ?").get(id);
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

  db.prepare(
    `UPDATE scheduled_transactions
     SET recipient = ?, amount = ?, asset = ?, memo = ?, frequency = ?, cron_expression = ?, status = ?
     WHERE id = ?`,
  ).run(
    merged.recipient,
    String(merged.amount),
    merged.asset,
    merged.memo || null,
    merged.frequency,
    resolvedCron,
    merged.status,
    id,
  );

  const updated = db.prepare("SELECT * FROM scheduled_transactions WHERE id = ?").get(id);

  if (updated.status === "active") {
    registerCronJob(updated);
  } else {
    unregisterCronJob(id);
  }

  return updated;
}

function deleteSchedule(id) {
  const existing = db.prepare("SELECT * FROM scheduled_transactions WHERE id = ?").get(id);
  if (!existing) return false;
  unregisterCronJob(id);
  db.prepare("DELETE FROM scheduled_transactions WHERE id = ?").run(id);
  return true;
}

function listPendingExecutions(ownerPk) {
  validatePublicKey(ownerPk);
  return db
    .prepare(
      `SELECT pe.*, st.recipient, st.amount, st.asset
       FROM pending_executions pe
       JOIN scheduled_transactions st ON st.id = pe.schedule_id
       WHERE pe.owner_pk = ? AND pe.status = 'awaiting_signature'
       ORDER BY pe.created_at DESC`,
    )
    .all(ownerPk);
}

async function submitPendingExecution(id, signedXDR) {
  const pending = db.prepare("SELECT * FROM pending_executions WHERE id = ?").get(id);
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
    db.prepare(
      "UPDATE pending_executions SET status = 'submitted', submitted_hash = ?, resolved_at = CURRENT_TIMESTAMP WHERE id = ?",
    ).run(result.hash, id);
    return { status: "submitted", hash: result.hash };
  } catch (err) {
    db.prepare(
      "UPDATE pending_executions SET status = 'failed', error = ?, resolved_at = CURRENT_TIMESTAMP WHERE id = ?",
    ).run(err.message, id);
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
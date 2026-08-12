/**
 * src/jobs/webhookDeliveryWorker.js
 *
 * Dedicated delivery worker for webhook retries with exponential backoff,
 * per issue #494. Polls every 10 seconds (WEBHOOK_WORKER_INTERVAL_MS) for
 * deliveries due for (re)delivery, ordered by priority, processes up to 50
 * per cycle, and transitions status pending -> in_flight -> delivered/failed.
 *
 * This complements (does not replace) webhookService.processRetryQueue,
 * which runs on a slower 30s cadence for legacy compatibility.
 */

"use strict";

const logger = require("../utils/logger");
const knex = require("../db/connection");
const webhookService = require("../services/webhookService");

const WORKER_INTERVAL_MS = parseInt(process.env.WEBHOOK_WORKER_INTERVAL_MS, 10) || 10000;
const BATCH_SIZE = 50;

let workerTimer = null;
let isRunning = false;

async function getDueDeliveries() {
  return knex("webhook_deliveries")
    .whereIn("status", ["pending", "failed"])
    .andWhere(function () {
      this.whereNull("next_retry_at").orWhere("next_retry_at", "<=", new Date().toISOString());
    })
    .orderBy([
      { column: "delivery_priority", order: "desc" },
      { column: "attempts", order: "asc" },
      { column: "next_retry_at", order: "asc" },
    ])
    .limit(BATCH_SIZE);
}

async function processDelivery(delivery) {
  const startedAt = Date.now();
  await knex("webhook_deliveries").where("id", delivery.id).update({ status: "in_flight" });

  const webhookRow = await knex("webhooks").where("id", delivery.webhook_id).first();
  if (!webhookRow) {
    await knex("webhook_deliveries")
      .where("id", delivery.id)
      .update({ status: "failed", last_error: "Webhook not found" });
    return;
  }

  logger.info({
    type: "webhook_delivery_worker_processing",
    deliveryId: delivery.id,
    webhookId: delivery.webhook_id,
    attempt: (delivery.attempts || 0) + 1,
  });

  try {
    await webhookService.deliverWebhook(
      {
        id: webhookRow.id,
        publicKey: webhookRow.public_key,
        url: webhookRow.url,
        secret: webhookRow.secret,
        attempts: delivery.attempts,
      },
      typeof delivery.payload === "string" ? JSON.parse(delivery.payload) : delivery.payload,
      delivery.event_type,
    );
  } catch (err) {
    logger.error({
      type: "webhook_delivery_worker_error",
      deliveryId: delivery.id,
      error: err.message,
    });
  } finally {
    logger.info({
      type: "webhook_delivery_worker_cycle_timing",
      deliveryId: delivery.id,
      durationMs: Date.now() - startedAt,
    });
  }
}

async function runCycle() {
  if (isRunning) return;
  isRunning = true;
  try {
    const due = await getDueDeliveries();
    for (const delivery of due) {
      await processDelivery(delivery);
    }
  } catch (err) {
    logger.error({ type: "webhook_delivery_worker_cycle_error", error: err.message });
  } finally {
    isRunning = false;
  }
}

function startWorker() {
  if (workerTimer) return;
  workerTimer = setInterval(runCycle, WORKER_INTERVAL_MS);
  logger.info({ type: "webhook_delivery_worker_started", intervalMs: WORKER_INTERVAL_MS });
}

function stopWorker() {
  if (workerTimer) {
    clearInterval(workerTimer);
    workerTimer = null;
    logger.info({ type: "webhook_delivery_worker_stopped" });
  }
}

module.exports = { startWorker, stopWorker, runCycle, getDueDeliveries };

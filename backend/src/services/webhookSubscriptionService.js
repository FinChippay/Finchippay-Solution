"use strict";

const crypto = require("crypto");
const { Horizon } = require("@stellar/stellar-sdk");
const knex = require("../db/connection");
const logger = require("../utils/logger");
const metrics = require("./metricsService");
const core = require("./webhookService");
const {
  SUPPORTED_WEBHOOK_TOPICS,
  normalizeTopics,
  serializeTopics,
  parseTopics,
  matchesWebhookTopic,
} = require("./webhookTopics");

const HORIZON_URL = process.env.HORIZON_URL || "https://horizon-testnet.stellar.org";
const server = new Horizon.Server(HORIZON_URL);
const activeStreams = new Map();
const pendingDeliveries = new Set();

function rowToWebhook(row) {
  return {
    id: row.id,
    publicKey: row.public_key,
    url: row.url,
    secret: row.secret,
    topics: parseTopics(row.topics),
    createdAt: row.created_at,
  };
}

async function getWebhookRecordsByPublicKey(publicKey) {
  const rows = await knex("webhooks").where("public_key", publicKey);
  return rows.map(rowToWebhook);
}

async function getWebhookRecordById(id) {
  const row = await knex("webhooks").where("id", id).first();
  return row ? rowToWebhook(row) : null;
}

async function registerWebhook(publicKey, url, secret, topics = ["all"]) {
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const normalizedTopics = normalizeTopics(topics);

  await knex("webhooks").insert({
    id,
    public_key: publicKey,
    url,
    secret,
    topics: serializeTopics(normalizedTopics),
    created_at: createdAt,
  });

  startMonitoring(publicKey);
  logger.info({
    type: "webhook_registered",
    id,
    publicKey,
    url,
    topics: normalizedTopics,
  });

  return {
    id,
    publicKey,
    url,
    topics: normalizedTopics,
    createdAt,
  };
}

async function getWebhooksByPublicKey(publicKey) {
  const hooks = await getWebhookRecordsByPublicKey(publicKey);
  return hooks.map(({ id, publicKey: key, url, topics, createdAt }) => ({
    id,
    publicKey: key,
    url,
    topics,
    createdAt,
  }));
}

async function deliverWebhook(webhook, payload, eventType = "payment.received") {
  let resolvedWebhook = webhook;
  if (!resolvedWebhook.secret && resolvedWebhook.id) {
    resolvedWebhook = await getWebhookRecordById(resolvedWebhook.id);
  }

  if (!resolvedWebhook) {
    logger.warn({
      type: "webhook_not_found",
      webhookId: webhook && webhook.id,
      eventType,
    });
    return { delivered: false, reason: "webhook_not_found" };
  }

  if (!matchesWebhookTopic(resolvedWebhook.topics, eventType)) {
    logger.debug({
      type: "webhook_topic_filtered",
      id: resolvedWebhook.id,
      eventType,
      topics: normalizeTopics(resolvedWebhook.topics),
    });
    return { delivered: false, reason: "topic_filtered" };
  }

  await core.deliverWebhook(resolvedWebhook, payload, eventType);
  return { delivered: true };
}

function startMonitoring(publicKey) {
  if (activeStreams.has(publicKey)) return;

  metrics.horizonRequestsTotal.inc({
    operation: "startSSE",
    status: "success",
  });

  const closeStream = server
    .payments()
    .forAccount(publicKey)
    .cursor("now")
    .stream({
      onmessage: async (payment) => {
        if (payment.type !== "payment" || payment.to !== publicKey) return;

        const payload = {
          event: "payment.received",
          publicKey,
          payment: {
            id: payment.id,
            from: payment.from,
            to: payment.to,
            amount: payment.amount,
            asset: payment.asset_type === "native" ? "XLM" : payment.asset_code,
            createdAt: payment.created_at,
          },
        };

        const hooks = await getWebhookRecordsByPublicKey(publicKey);
        const deliveries = hooks.map((hook) => {
          const promise = deliverWebhook(hook, payload, "payment.received").finally(() =>
            pendingDeliveries.delete(promise),
          );
          pendingDeliveries.add(promise);
          return promise;
        });

        await Promise.allSettled(deliveries);
      },
      onerror: (err) => {
        logger.error({
          type: "horizon_sse_error",
          publicKey,
          error: err.message,
        });
        metrics.horizonRequestsTotal.inc({ operation: "sse", status: "error" });
        activeStreams.delete(publicKey);
        metrics.activeWebhookStreams.set(activeStreams.size);
      },
    });

  activeStreams.set(publicKey, closeStream);
  metrics.activeWebhookStreams.set(activeStreams.size);
  logger.info({ type: "horizon_monitoring_started", publicKey });
}

async function closeAllStreams(timeoutMs = 5000) {
  for (const [publicKey, close] of activeStreams) {
    try {
      close();
    } catch (err) {
      logger.error({
        type: "stream_close_error",
        publicKey,
        error: err.message,
      });
    }
  }
  activeStreams.clear();
  metrics.activeWebhookStreams.set(0);

  if (pendingDeliveries.size > 0) {
    await Promise.race([
      Promise.allSettled([...pendingDeliveries]),
      new Promise((resolve) => setTimeout(resolve, timeoutMs)),
    ]);
  }
  pendingDeliveries.clear();
  await core.closeAllStreams(timeoutMs);
}

async function replayEvents(publicKey, { eventIds, since, until }) {
  const query = knex("webhook_events as e")
    .join("webhooks as w", "e.webhook_id", "w.id")
    .where("w.public_key", publicKey)
    .select("e.*");

  if (eventIds && eventIds.length > 0) {
    query.whereIn("e.id", eventIds);
  } else {
    if (since) query.andWhere("e.created_at", ">=", since);
    if (until) query.andWhere("e.created_at", "<=", until);
  }

  const eventsToReplay = await query;
  let replayed = 0;

  for (const event of eventsToReplay) {
    const webhook = await getWebhookRecordById(event.webhook_id);
    if (!webhook) continue;

    const payload = typeof event.payload === "string" ? JSON.parse(event.payload) : event.payload;
    const result = await deliverWebhook(webhook, payload, event.event_type);
    if (result.delivered) replayed += 1;
  }

  return { replayed };
}

module.exports = {
  ...core,
  registerWebhook,
  getWebhooksByPublicKey,
  deliverWebhook,
  closeAllStreams,
  replayEvents,
  SUPPORTED_WEBHOOK_TOPICS,
  normalizeTopics,
  parseTopics,
  matchesWebhookTopic,
};

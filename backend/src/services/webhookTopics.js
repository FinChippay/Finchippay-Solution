"use strict";

const SUPPORTED_WEBHOOK_TOPICS = Object.freeze([
  "payment.received",
  "payment.sent",
  "escrow.created",
  "escrow.claimed",
  "escrow.cancelled",
  "stream.claimed",
  "stream.closed",
  "multisig.executed",
  "tip.received",
  "all",
]);

function normalizeTopics(topics) {
  if (!Array.isArray(topics) || topics.length === 0 || topics.includes("all")) {
    return ["all"];
  }

  return [...new Set(topics)];
}

function serializeTopics(topics) {
  return JSON.stringify(normalizeTopics(topics));
}

function parseTopics(value) {
  if (Array.isArray(value)) return normalizeTopics(value);
  if (typeof value !== "string" || !value.trim()) return ["all"];

  try {
    return normalizeTopics(JSON.parse(value));
  } catch {
    return ["all"];
  }
}

function matchesWebhookTopic(topics, eventType) {
  const normalized = normalizeTopics(topics);
  return normalized.includes("all") || normalized.includes(eventType);
}

module.exports = {
  SUPPORTED_WEBHOOK_TOPICS,
  normalizeTopics,
  serializeTopics,
  parseTopics,
  matchesWebhookTopic,
};

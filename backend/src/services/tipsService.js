/**
 * src/services/tipsService.js
 * Business logic for tracking tips received by creators.
 * Uses Knex-backed SQLite/PostgreSQL for persistent storage.
 */

"use strict";

const knex = require("../db/connection");
const { applyKnexKeyset } = require("../utils/paginate");
const logger = require("../utils/logger");

// Lazy-load pushService to avoid a circular dependency at module initialisation
// and to gracefully degrade when VAPID keys are not configured.
function getPushService() {
  try {
    return require("./pushService");
  } catch {
    return null;
  }
}

// Stable keyset ordering for tip lists: newest first, `id` as the unique
// tiebreaker (created_at resolution is coarse and can collide).
const TIP_KEYSET = [
  ["created_at", "desc"],
  ["id", "desc"],
];

/**
 * Record a tip sent to a creator.
 * @param {string} senderPublicKey - The Stellar public key of the sender
 * @param {string} creatorPublicKey - The Stellar public key of the creator
 * @param {string} amount - The amount sent
 * @param {string} asset - The asset code (XLM, USDC, etc.)
 * @param {string} [memo] - Optional memo/message from sender
 * @param {string} [txHash] - The transaction hash
 * @returns {Promise<object>} The created tip record
 */
async function recordTip({
  senderPublicKey,
  creatorPublicKey,
  amount,
  asset = "XLM",
  memo = "",
  txHash = "",
}) {
  if (!senderPublicKey || !creatorPublicKey || !amount) {
    const error = new Error(
      "senderPublicKey, creatorPublicKey, and amount are required",
    );
    error.status = 400;
    throw error;
  }

  const [id] = await knex("tips").insert({
    sender_pk: senderPublicKey,
    creator_pk: creatorPublicKey,
    amount: String(amount),
    asset,
    memo,
    tx_hash: txHash,
    created_at: new Date().toISOString(),
  });

  const tip = await knex("tips").where("id", id).first();

  const result = {
    id: tip.id,
    senderPublicKey: tip.sender_pk,
    creatorPublicKey: tip.creator_pk,
    amount: tip.amount,
    asset: tip.asset,
    memo: tip.memo,
    txHash: tip.tx_hash,
    timestamp: tip.created_at,
  };

  // Fire-and-forget push notification to the creator
  const push = getPushService();
  if (push) {
    push
      .sendNotification(creatorPublicKey, {
        title: "You received a tip! 🎉",
        body: `${amount} ${asset} from a supporter`,
        url: "/dashboard",
      })
      .catch((err) =>
        logger.error({ err }, "Push notification failed (recordTip)")
      );
  }

  return result;
}

/**
 * Get all tips received by a creator.
 * @param {string} creatorPublicKey - The Stellar public key of the creator
 * @param {object} [options] - Optional filters
 * @param {number} [options.limit] - Page size (number of tips to return)
 * @param {object|null} [options.cursor] - Keyset cursor from a previous page
 * @returns {Promise<object>} Object with tips array (up to limit+1) and total count
 */
async function getTipsReceived(creatorPublicKey, options = {}) {
  if (!creatorPublicKey) {
    const error = new Error("creatorPublicKey is required");
    error.status = 400;
    throw error;
  }

  const { limit = 20, cursor = null } = options;

  const base = knex("tips").where("creator_pk", creatorPublicKey);

  const [{ count: total }] = await base.clone().count("* as count");

  // Fetch limit+1 so the caller can detect whether another page exists.
  const rows = await applyKnexKeyset(base.clone(), cursor, TIP_KEYSET)
    .orderBy("created_at", "desc")
    .orderBy("id", "desc")
    .limit(limit + 1);

  const tips = rows.map((row) => ({
    id: row.id,
    senderPublicKey: row.sender_pk,
    creatorPublicKey: row.creator_pk,
    amount: row.amount,
    asset: row.asset,
    memo: row.memo,
    txHash: row.tx_hash,
    timestamp: row.created_at,
  }));

  return {
    tips,
    total: Number(total),
  };
}

/**
 * Get statistics for tips received by a creator.
 * @param {string} creatorPublicKey - The Stellar public key of the creator
 * @returns {Promise<object>} Object with total tips, total amount by asset
 */
async function getTipsStats(creatorPublicKey) {
  if (!creatorPublicKey) {
    const error = new Error("creatorPublicKey is required");
    error.status = 400;
    throw error;
  }

  const rows = await knex("tips")
    .where("creator_pk", creatorPublicKey)
    .select("amount", "asset");

  const stats = {
    totalTips: rows.length,
    totalByAsset: {},
    averageTip: null,
    largestTip: null,
    smallestTip: null,
  };

  // Calculate totals by asset
  for (const row of rows) {
    const asset = row.asset || "XLM";
    if (!stats.totalByAsset[asset]) {
      stats.totalByAsset[asset] = { count: 0, amount: 0 };
    }
    stats.totalByAsset[asset].count++;
    stats.totalByAsset[asset].amount += parseFloat(row.amount);
  }

  // Convert amounts to strings with proper precision
  for (const asset of Object.keys(stats.totalByAsset)) {
    stats.totalByAsset[asset].amount = String(stats.totalByAsset[asset].amount);
  }

  // Calculate average, largest, smallest
  if (rows.length > 0) {
    const amounts = rows.map((r) => parseFloat(r.amount));
    const totalAmount = amounts.reduce((sum, a) => sum + a, 0);
    stats.averageTip = String(totalAmount / rows.length);
    stats.largestTip = String(Math.max(...amounts));
    stats.smallestTip = String(Math.min(...amounts));
  }

  return stats;
}

/**
 * Get all tips sent by a user (for sender's history).
 * @param {string} senderPublicKey - The Stellar public key of the sender
 * @param {object} [options] - Optional filters
 * @param {number} [options.limit] - Page size (number of tips to return)
 * @param {object|null} [options.cursor] - Keyset cursor from a previous page
 * @returns {Promise<object>} Object with tips array (up to limit+1) and total count
 */
async function getTipsSent(senderPublicKey, options = {}) {
  if (!senderPublicKey) {
    const error = new Error("senderPublicKey is required");
    error.status = 400;
    throw error;
  }

  const { limit = 20, cursor = null } = options;

  const base = knex("tips").where("sender_pk", senderPublicKey);

  const [{ count: total }] = await base.clone().count("* as count");

  const rows = await applyKnexKeyset(base.clone(), cursor, TIP_KEYSET)
    .orderBy("created_at", "desc")
    .orderBy("id", "desc")
    .limit(limit + 1);

  const tips = rows.map((row) => ({
    id: row.id,
    senderPublicKey: row.sender_pk,
    creatorPublicKey: row.creator_pk,
    amount: row.amount,
    asset: row.asset,
    memo: row.memo,
    txHash: row.tx_hash,
    timestamp: row.created_at,
  }));

  return {
    tips,
    total: Number(total),
  };
}

/**
 * Validate tip record input.
 */
function validateTipInput(data) {
  const errors = [];

  if (!data.senderPublicKey) {
    errors.push("senderPublicKey is required");
  } else if (!/^G[A-Z0-9]{55}$/.test(data.senderPublicKey)) {
    errors.push("Invalid sender public key format");
  }

  if (!data.creatorPublicKey) {
    errors.push("creatorPublicKey is required");
  } else if (!/^G[A-Z0-9]{55}$/.test(data.creatorPublicKey)) {
    errors.push("Invalid creator public key format");
  }

  if (!data.amount) {
    errors.push("amount is required");
  } else if (isNaN(parseFloat(data.amount)) || parseFloat(data.amount) <= 0) {
    errors.push("amount must be a positive number");
  }

  if (errors.length > 0) {
    const error = new Error(errors.join(", "));
    error.status = 400;
    throw error;
  }

  return true;
}

module.exports = {
  recordTip,
  getTipsReceived,
  getTipsStats,
  getTipsSent,
  validateTipInput,
};

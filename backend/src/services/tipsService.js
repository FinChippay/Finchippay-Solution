/**
 * src/services/tipsService.js
 * Business logic for tracking tips received by creators.
 * Uses Knex-backed SQLite/PostgreSQL for persistent storage.
 */

"use strict";

const knex = require("../db/connection");
const { applyKnexKeyset } = require("../utils/paginate");

// Stable keyset ordering for tip lists: newest first, `id` as the unique
// tiebreaker (created_at resolution is coarse and can collide).
const TIP_KEYSET = [
  ["created_at", "desc"],
  ["id", "desc"],
];

// Helper to derive a human-readable amount string from a DB row. Prefer
// integer `amount_stroops` (exact), falling back to legacy `amount` string.
function amountFromRow(row) {
  if (row && row.amount_stroops != null) {
    return Number(row.amount_stroops / 1e7).toFixed(7);
  }
  return row && row.amount != null ? String(row.amount) : null;
}

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
    const error = new Error("senderPublicKey, creatorPublicKey, and amount are required");
    error.status = 400;
    throw error;
  }

  // Prepare insert object. Use amount_stroops when the DB supports it for exact integer storage.
  const insertObj = {
    sender_pk: senderPublicKey,
    creator_pk: creatorPublicKey,
    asset,
    memo,
    tx_hash: txHash,
  };

  // Always store the human-readable amount string for backward compatibility
  insertObj.amount = String(amount);

  // If the database has an `amount_stroops` column, populate it too (stroops = amount * 10^7)
  try {
    const hasAmountStroops = await knex.schema.hasColumn("tips", "amount_stroops");
    if (hasAmountStroops) {
      const amountStroops = Math.round(parseFloat(amount) * 1e7);
      insertObj.amount_stroops = Number.isFinite(amountStroops) ? amountStroops : null;
    }

    const hasCreatedAt = await knex.schema.hasColumn("tips", "created_at");
    if (hasCreatedAt) {
      insertObj.created_at = new Date().toISOString();
    }
  } catch (e) {
    // Feature-detect failures are non-fatal; proceed with the basic insert
  }

  const [id] = await knex("tips").insert(insertObj);

  const tip = await knex("tips").where("id", id).first();

  // Derive the API amount string from amount_stroops when present, otherwise use stored amount
  const amountFromRow = (row) => {
    if (row.amount_stroops != null) {
      return Number(row.amount_stroops / 1e7).toFixed(7);
    }
    return row.amount != null ? String(row.amount) : null;
  };

  return {
    id: tip.id,
    senderPublicKey: tip.sender_pk,
    creatorPublicKey: tip.creator_pk,
    amount: amountFromRow(tip),
    asset: tip.asset,
    memo: tip.memo,
    txHash: tip.tx_hash,
    timestamp: tip.created_at,
  };
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
    amount: amountFromRow(row),
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

  // Read both legacy `amount` string and optional `amount_stroops` integer for accuracy
  const rows = await knex("tips")
    .where("creator_pk", creatorPublicKey)
    .select("amount", "amount_stroops", "asset");

  const stats = {
    totalTips: rows.length,
    totalByAsset: {},
    averageTip: null,
    largestTip: null,
    smallestTip: null,
  };

  // Calculate totals by asset using stroops when available
  const numericAmounts = [];
  for (const row of rows) {
    const asset = row.asset || "XLM";
    if (!stats.totalByAsset[asset]) {
      stats.totalByAsset[asset] = { count: 0, amount: 0 };
    }
    stats.totalByAsset[asset].count++;

    const amt =
      row.amount_stroops != null ? Number(row.amount_stroops) / 1e7 : parseFloat(row.amount) || 0;
    stats.totalByAsset[asset].amount += amt;
    numericAmounts.push(amt);
  }

  // Convert totals to strings
  for (const asset of Object.keys(stats.totalByAsset)) {
    stats.totalByAsset[asset].amount = String(stats.totalByAsset[asset].amount);
  }

  if (numericAmounts.length > 0) {
    const totalAmount = numericAmounts.reduce((sum, a) => sum + a, 0);
    stats.averageTip = String(totalAmount / numericAmounts.length);
    stats.largestTip = String(Math.max(...numericAmounts));
    stats.smallestTip = String(Math.min(...numericAmounts));
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
    amount: amountFromRow(row),
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

/**
 * src/services/sep/sep24Service.js
 * SEP-0024 (Hosted Deposit and Withdrawal) service.
 *
 * Manages interactive transaction state in-memory for the anchor flow:
 *   - POST /transactions/deposit/interactive  →  initiates interactive session
 *   - GET  /transaction                       →  polls transaction status
 *
 * Transaction lifecycle states:
 *   pending_external → completed | error
 *
 * This is a reference implementation for testnet.  In production the store
 * would be replaced with a persistent database.
 */

"use strict";

const { randomUUID } = require("crypto");

/** @type {Map<string, TransactionRecord>} */
const transactions = new Map();

// Asset code must be 1–12 alphanumeric characters (SEP-0001).
const ASSET_CODE_RE = /^[A-Za-z0-9]{1,12}$/;

// Stellar public key format: G + 55 base32 characters.
const PUBLIC_KEY_RE = /^G[A-Z0-9]{55}$/;

/**
 * @typedef {Object} TransactionRecord
 * @property {string}   id
 * @property {string}   kind          — "deposit" or "withdrawal"
 * @property {string}   status        — "pending_external" | "completed" | "error"
 * @property {string}   assetCode
 * @property {string}   account       — Stellar public key
 * @property {string}   [memo]        — optional memo
 * @property {string}   [memoType]    — optional memo type (text, id, hash)
 * @property {string}   [errorReason] — set when status === "error"
 * @property {string}   url           — interactive web URL for the user
 * @property {Date}     createdAt
 * @property {Date}     updatedAt
 */

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build the interactive KYC / deposit URL that the wallet must show the user.
 *
 * @param {Object}  opts
 * @param {string}  opts.id
 * @param {string}  opts.assetCode
 * @param {string}  opts.account
 * @param {"deposit"|"withdrawal"} opts.kind
 * @param {string}  [opts.anchorBaseUrl]
 * @returns {string}
 */
function _buildInteractiveUrl({ id, assetCode, account, kind, anchorBaseUrl }) {
  const base =
    anchorBaseUrl || process.env.TRANSFER_SERVER_URL || "http://localhost:4000";
  return (
    `${base}/kyc` +
    `?transaction_id=${encodeURIComponent(id)}` +
    `&asset_code=${encodeURIComponent(assetCode)}` +
    `&account=${encodeURIComponent(account)}` +
    `&kind=${encodeURIComponent(kind)}`
  );
}

/**
 * Validate common input fields.
 *
 * @param {Object} params
 * @param {string} params.assetCode
 * @param {string} params.account
 */
function _validateInput({ assetCode, account }) {
  if (!assetCode || !account) {
    const err = new Error("asset_code and account are required");
    err.status = 400;
    throw err;
  }

  if (!ASSET_CODE_RE.test(assetCode)) {
    const err = new Error(
      "Invalid asset_code format: must be 1–12 alphanumeric characters",
    );
    err.status = 400;
    throw err;
  }

  if (!PUBLIC_KEY_RE.test(account)) {
    const err = new Error("Invalid Stellar public key format");
    err.status = 400;
    throw err;
  }
}

/**
 * Create and store a new transaction record.
 *
 * @param {Object}   params
 * @param {string}   params.assetCode
 * @param {string}   params.account
 * @param {"deposit"|"withdrawal"} params.kind
 * @param {string}   [params.memo]
 * @param {string}   [params.memoType]
 * @param {string}   [params.anchorBaseUrl]
 * @returns {TransactionRecord}
 */
function _createTransaction(params) {
  const { assetCode, account, kind, memo, memoType, anchorBaseUrl } = params;

  _validateInput({ assetCode, account });

  const id = randomUUID();
  const url = _buildInteractiveUrl({
    id,
    assetCode,
    account,
    kind,
    anchorBaseUrl,
  });

  const record = {
    id,
    kind,
    status: "pending_external",
    assetCode,
    account,
    memo: memo || null,
    memoType: memoType || null,
    url,
    errorReason: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  transactions.set(id, record);
  return record;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Initiate a new interactive deposit.
 *
 * @param {Object}        params
 * @param {string}        params.assetCode   - e.g. "USDC", "XLM"
 * @param {string}        params.account     - Stellar public key (G…)
 * @param {string}        [params.memo]
 * @param {string}        [params.memoType]
 * @param {string}        [params.anchorBaseUrl]  - base URL of the anchor's interactive flow
 * @returns {TransactionRecord}
 */
function initiateDeposit(params) {
  return _createTransaction({ ...params, kind: "deposit" });
}

/**
 * Initiate a new interactive withdrawal.
 *
 * @param {Object}        params
 * @param {string}        params.assetCode
 * @param {string}        params.account
 * @param {string}        [params.memo]
 * @param {string}        [params.memoType]
 * @param {string}        [params.anchorBaseUrl]
 * @returns {TransactionRecord}
 */
function initiateWithdrawal(params) {
  return _createTransaction({ ...params, kind: "withdrawal" });
}

/**
 * Get a transaction by its ID.
 *
 * @param {string} id
 * @returns {TransactionRecord|null}
 */
function getTransaction(id) {
  return transactions.get(id) || null;
}

/**
 * Update the status of a transaction.
 *
 * Valid transitions:
 *   pending_external → completed
 *   pending_external → error
 *
 * @param {string} id
 * @param {"completed"|"error"} status
 * @param {string} [errorReason] - required when status === "error"
 * @returns {TransactionRecord}
 */
function updateTransactionStatus(id, status, errorReason) {
  const record = transactions.get(id);
  if (!record) {
    const err = new Error("Transaction not found");
    err.status = 404;
    throw err;
  }

  if (status !== "completed" && status !== "error") {
    const err = new Error(
      `Invalid status transition: "${status}". Allowed: completed, error`,
    );
    err.status = 400;
    throw err;
  }

  record.status = status;
  record.updatedAt = new Date();

  if (status === "error") {
    record.errorReason = errorReason || "Unknown error";
  }

  return record;
}

/**
 * List all transactions (useful for testing / admin).
 * @returns {TransactionRecord[]}
 */
function listTransactions() {
  return Array.from(transactions.values());
}

/**
 * Clear the in-memory store (used in tests).
 */
function clearStore() {
  transactions.clear();
}

module.exports = {
  initiateDeposit,
  initiateWithdrawal,
  getTransaction,
  updateTransactionStatus,
  listTransactions,
  clearStore,
};

/**
 * src/routes/sep24.js
 * SEP-0024 (Hosted Deposit and Withdrawal) route handlers.
 *
 * POST /api/sep24/transactions/deposit/interactive  – initiate interactive deposit
 * POST /api/sep24/transactions/withdraw/interactive – initiate interactive withdrawal
 * GET  /api/sep24/transaction                        – poll transaction status
 */

"use strict";

const express = require("express");
const router = express.Router();
const sep24Service = require("../services/sep/sep24Service");
const { formatErrorResponse, ERROR_CODES } = require("../../../shared/errorCodes");

/**
 * POST /api/sep24/transactions/deposit/interactive
 *
 * Initiates an anchor interactive deposit session.
 *
 * Request body (JSON):
 *   - asset_code  (required) — e.g. "USDC", "XLM"
 *   - account     (required) — Stellar public key (G…)
 *   - memo        (optional)
 *   - memo_type   (optional)
 *   - anchor_url  (optional) — override for the anchor's interactive flow URL
 *
 * Response 200:
 *   { type: "interactive_customer_info_needed", url: string, id: string }
 */
router.post("/transactions/deposit/interactive", (req, res) => {
  try {
    const { asset_code, account, memo, memo_type, anchor_url } = req.body;

    if (!asset_code || !account) {
      return res
        .status(ERROR_CODES.VAL_MISSING_FIELD.httpStatus)
        .json(formatErrorResponse("VAL_MISSING_FIELD", { fields: ["asset_code", "account"] }));
    }

    const record = sep24Service.initiateDeposit({
      assetCode: asset_code,
      account,
      memo,
      memoType: memo_type,
      anchorBaseUrl: anchor_url,
    });

    res.json({
      type: "interactive_customer_info_needed",
      url: record.url,
      id: record.id,
    });
  } catch (err) {
    const status = err.status || 500;
    const errorCode = err.errorCode || "SRV_INTERNAL";
    res.status(status).json(formatErrorResponse(errorCode, { reason: err.message }));
  }
});

/**
 * POST /api/sep24/transactions/withdraw/interactive
 *
 * Initiates an anchor interactive withdrawal session.
 *
 * Request body (JSON):
 *   - asset_code  (required)
 *   - account     (required)
 *   - memo        (optional)
 *   - memo_type   (optional)
 *   - anchor_url  (optional)
 *
 * Response 200:
 *   { type: "interactive_customer_info_needed", url: string, id: string }
 */
router.post("/transactions/withdraw/interactive", (req, res) => {
  try {
    const { asset_code, account, memo, memo_type, anchor_url } = req.body;

    if (!asset_code || !account) {
      return res
        .status(ERROR_CODES.VAL_MISSING_FIELD.httpStatus)
        .json(formatErrorResponse("VAL_MISSING_FIELD", { fields: ["asset_code", "account"] }));
    }

    const record = sep24Service.initiateWithdrawal({
      assetCode: asset_code,
      account,
      memo,
      memoType: memo_type,
      anchorBaseUrl: anchor_url,
    });

    res.json({
      type: "interactive_customer_info_needed",
      url: record.url,
      id: record.id,
    });
  } catch (err) {
    const status = err.status || 500;
    const errorCode = err.errorCode || "SRV_INTERNAL";
    res.status(status).json(formatErrorResponse(errorCode, { reason: err.message }));
  }
});

/**
 * GET /api/sep24/transaction?id=<uuid>
 *
 * Polls the current status of an interactive transaction.
 *
 * Response 200:
 *   {
 *     transaction: {
 *       id: string,
 *       kind: "deposit" | "withdrawal",
 *       status: "pending_external" | "completed" | "error",
 *       status_eta: number | null,
 *       more_info_url: string | null,
 *       amount_in: string | null,
 *       amount_out: string | null,
 *       amount_fee: string | null,
 *       started_at: string,
 *       updated_at: string,
 *       completed_at: string | null,
 *       stellar_transaction_id: string | null,
 *       external_transaction_id: string | null,
 *       message: string | null
 *     }
 *   }
 *
 * Response 404:
 *   { error: "Transaction not found" }
 */
router.get("/transaction", (req, res) => {
  const { id } = req.query;

  if (!id) {
    return res
      .status(ERROR_CODES.VAL_MISSING_FIELD.httpStatus)
      .json(formatErrorResponse("VAL_MISSING_FIELD", { fields: ["id"] }));
  }

  const record = sep24Service.getTransaction(id);
  if (!record) {
    return res
      .status(ERROR_CODES.RES_NOT_FOUND.httpStatus)
      .json(formatErrorResponse("RES_NOT_FOUND", { resourceType: "transaction" }));
  }

  // Build the SEP-0024 compliant transaction response
  const txn = {
    id: record.id,
    kind: record.kind,
    status: record.status,
    status_eta: null,
    more_info_url: record.url,
    amount_in: null,
    amount_out: null,
    amount_fee: null,
    started_at: record.createdAt.toISOString(),
    updated_at: record.updatedAt.toISOString(),
    completed_at:
      record.status === "completed" ? record.updatedAt.toISOString() : null,
    stellar_transaction_id: null,
    external_transaction_id: null,
    message: record.errorReason || null,
  };

  res.json({ transaction: txn });
});

/**
 * POST /api/sep24/deposit
 * Initiates a REAL interactive deposit against a configured Stellar anchor.
 * Body: { assetCode, assetIssuer, amount, anchorName, account, token }
 */
router.post("/deposit", async (req, res) => {
  try {
    const { assetCode, assetIssuer, amount, anchorName, account, token } = req.body;
    if (!assetCode || !account) {
      return res
        .status(ERROR_CODES.VAL_MISSING_FIELD.httpStatus)
        .json(formatErrorResponse("VAL_MISSING_FIELD", { fields: ["assetCode", "account"] }));
    }
    const result = await sep24Service.callAnchorDeposit({
      account,
      assetCode,
      assetIssuer,
      amount,
      anchorName,
      token,
    });
    res.json(result);
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json(formatErrorResponse(err.errorCode || "SRV_INTERNAL", { reason: err.message }));
  }
});

/**
 * POST /api/sep24/withdraw
 * Initiates a REAL interactive withdrawal against a configured Stellar anchor.
 * Body: { assetCode, assetIssuer, amount, destAccount, anchorName, account, token }
 */
router.post("/withdraw", async (req, res) => {
  try {
    const { assetCode, assetIssuer, amount, destAccount, anchorName, account, token } = req.body;
    if (!assetCode || !account || !destAccount) {
      return res
        .status(ERROR_CODES.VAL_MISSING_FIELD.httpStatus)
        .json(formatErrorResponse("VAL_MISSING_FIELD", { fields: ["assetCode", "account", "destAccount"] }));
    }
    const result = await sep24Service.callAnchorWithdraw({
      account,
      assetCode,
      assetIssuer,
      amount,
      destAccount,
      anchorName,
      token,
    });
    res.json(result);
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json(formatErrorResponse(err.errorCode || "SRV_INTERNAL", { reason: err.message }));
  }
});

/**
 * GET /api/sep24/transactions/:txId
 * Returns the current status of an anchor-backed transaction.
 */
router.get("/transactions/:txId", (req, res) => {
  const record = sep24Service.getAnchorTransaction(req.params.txId);
  if (!record) {
    return res
      .status(ERROR_CODES.RES_NOT_FOUND.httpStatus)
      .json(formatErrorResponse("RES_NOT_FOUND", { resourceType: "transaction" }));
  }
  res.json({ transaction: record });
});

/**
 * POST /api/sep24/callback
 * Webhook endpoint for the anchor to POST transaction status updates.
 */
router.post("/callback", (req, res) => {
  try {
    sep24Service.handleAnchorCallback(req.body);
    res.status(200).json({ received: true });
  } catch (err) {
    const status = err.status || 400;
    res.status(status).json(formatErrorResponse(err.errorCode || "VAL_INVALID_JSON", { reason: err.message }));
  }
});

module.exports = router;

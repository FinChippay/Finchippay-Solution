/**
 * src/routes/sep24.js
 * SEP-0024 (Hosted Deposit and Withdrawal) route handlers.
 *
 * POST /api/sep24/transactions/deposit/interactive  – initiate interactive deposit
 * POST /api/sep24/transactions/withdraw/interactive – initiate interactive withdrawal
 * GET  /api/sep24/transaction                        – poll transaction status
 * POST /api/sep24/deposit                             – anchor deposit
 * POST /api/sep24/withdraw                             – anchor withdrawal
 * GET  /api/sep24/transactions/:txId                  – anchor transaction status
 * POST /api/sep24/callback                             – anchor webhook callback
 */

"use strict";

const express = require("express");
const router = express.Router();
const sep24Service = require("../services/sep/sep24Service");
const { validate } = require("../validation/middleware");
const {
  sep24InteractiveSchema,
  sep24TransactionQuerySchema,
  sep24DepositWithdrawSchema,
} = require("../validation/schemas");
const { formatErrorResponse, ERROR_CODES } = require("../../../shared/errorCodes");
const { verifyInboundWebhookSignature } = require("../middleware/verifyInboundWebhookSignature");

const SEP24_CALLBACK_ENDPOINT = "sep24_callback";

/**
 * POST /api/sep24/transactions/deposit/interactive
 *
 * Initiates an anchor interactive deposit session.
 */
router.post("/transactions/deposit/interactive", validate(sep24InteractiveSchema), (req, res) => {
  try {
    const { asset_code, account, memo, memo_type, anchor_url } = req.validated;

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
    res.status(status).json({ error: err.message });
  }
});

/**
 * POST /api/sep24/transactions/withdraw/interactive
 *
 * Initiates an anchor interactive withdrawal session.
 */
router.post("/transactions/withdraw/interactive", validate(sep24InteractiveSchema), (req, res) => {
  try {
    const { asset_code, account, memo, memo_type, anchor_url } = req.validated;

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
    res.status(status).json({ error: err.message });
  }
});

/**
 * GET /api/sep24/transaction?id=<uuid>
 *
 * Polls the current status of an interactive transaction.
 */
router.get("/transaction", validate(sep24TransactionQuerySchema, "query"), (req, res) => {
  const { id } = req.validated;

  const record = sep24Service.getTransaction(id);
  if (!record) {
    return res
      .status(ERROR_CODES.RES_NOT_FOUND.httpStatus)
      .json(formatErrorResponse("RES_NOT_FOUND", { resourceType: "transaction" }));
  }

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
    completed_at: record.status === "completed" ? record.updatedAt.toISOString() : null,
    stellar_transaction_id: null,
    external_transaction_id: null,
    message: record.errorReason || null,
  };

  res.json({ transaction: txn });
});

/**
 * POST /api/sep24/deposit
 * Initiates a REAL interactive deposit against a configured Stellar anchor.
 */
router.post("/deposit", validate(sep24DepositWithdrawSchema), async (req, res) => {
  try {
    const { assetCode, assetIssuer, amount, anchorName, account, token } = req.validated;
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
    res.status(status).json(
      formatErrorResponse(err.errorCode || "SRV_INTERNAL", {
        reason: err.message,
      }),
    );
  }
});

/**
 * POST /api/sep24/withdraw
 * Initiates a REAL interactive withdrawal against a configured Stellar anchor.
 */
router.post("/withdraw", validate(sep24DepositWithdrawSchema), async (req, res) => {
  try {
    const { assetCode, assetIssuer, amount, destAccount, anchorName, account, token } =
      req.validated;
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
    res.status(status).json(
      formatErrorResponse(err.errorCode || "SRV_INTERNAL", {
        reason: err.message,
      }),
    );
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
 *
 * Requires a valid X-Signature / X-Timestamp pair (see
 * verifyInboundWebhookSignature.js) — an unauthenticated caller must not be
 * able to flip a transaction to "completed".
 */
router.post("/callback", verifyInboundWebhookSignature(SEP24_CALLBACK_ENDPOINT), (req, res) => {
  try {
    sep24Service.handleAnchorCallback(req.body);
    res.status(200).json({ received: true });
  } catch (err) {
    const status = err.status || 400;
    res.status(status).json(
      formatErrorResponse(err.errorCode || "VAL_INVALID_JSON", {
        reason: err.message,
      }),
    );
  }
});

module.exports = router;

/**
 * src/controllers/accountController.js
 * HTTP handlers for Stellar account data and username registration.
 *
 * Routes handled:
 *   GET  /api/accounts/:publicKey           → account details + balances
 *   GET  /api/accounts/:publicKey/balance   → XLM balance only
 *   POST /api/accounts/register             → register username ↔ public key
 *   GET  /api/accounts/resolve/:username    → resolve username → public key
 *
 * All handlers delegate to `stellarService` / `usernameService` and forward
 * errors to the global Express error handler via `next(err)`.
 */

"use strict";

const stellarService = require("../services/stellarService");
const usernameService = require("../services/usernameService");
const { formatErrorResponse, ERROR_CODES } = require("../../../shared/errorCodes");

/**
 * GET /api/accounts/:publicKey
 * Load a Stellar account and return its sequence number, balances, and
 * sub-entry count.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 *
 * @returns {200} { success: true, data: { publicKey, sequence, balances, subentryCount } }
 * @returns {400} Invalid public key format.
 * @returns {404} Account not found on the Stellar network.
 */
async function getAccount(req, res, next) {
  try {
    const { publicKey } = req.params;
    const account = await stellarService.getAccount(publicKey);
    res.json({ success: true, data: account });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/accounts/:publicKey/balance
 * Return only the native XLM balance for an account.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 *
 * @returns {200} { success: true, data: { publicKey, xlm: string } }
 * @returns {400} Invalid public key format.
 * @returns {404} Account not found on the Stellar network.
 */
async function getBalance(req, res, next) {
  try {
    const { publicKey } = req.params;
    const balance = await stellarService.getXLMBalance(publicKey);
    res.json({ success: true, data: { publicKey, xlm: balance } });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/accounts/register
 * Register a new Finchippay username tied to a Stellar public key.
 *
 * Body: { username: string, publicKey: string }
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 *
 * @returns {201} { success: true, data: { username, publicKey }, message }
 * @returns {400} Missing or invalid fields.
 * @returns {409} Username or public key already registered.
 */
async function registerUsername(req, res, next) {
  try {
    const { username, publicKey } = req.body;

    if (!username || !publicKey) {
      return res
        .status(ERROR_CODES.VAL_MISSING_FIELD.httpStatus)
        .json(formatErrorResponse("VAL_MISSING_FIELD", {
          fields: ["username", "publicKey"],
        }));
    }

    const result = usernameService.registerUsername(username, publicKey);
    return res.status(201).json({
      success: true,
      data: result,
      message: "Username registered successfully",
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/accounts/resolve/:username
 * Resolve a Finchippay username to its associated Stellar public key.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 *
 * @returns {200} { success: true, data: { username, publicKey } }
 * @returns {404} Username not found.
 * @returns {501} Reserved test username 'alice' is not implemented.
 */
async function resolveUsername(req, res, next) {
  try {
    const { username } = req.params;

    // Reserve 'alice' for test suites without polluting the production store.
    if (username.toLowerCase() === "alice") {
      return res
        .status(ERROR_CODES.SRV_NOT_IMPLEMENTED.httpStatus)
        .json(formatErrorResponse("SRV_NOT_IMPLEMENTED", { feature: "Reserved test username" }));
    }

    const result = usernameService.resolveUsername(username);
    return res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

module.exports = { getAccount, getBalance, registerUsername, resolveUsername };

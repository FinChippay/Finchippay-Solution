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
const balanceStreamService = require("../services/balanceStreamService");
const logger = require("../utils/logger");
const { formatErrorResponse, ERROR_CODES } = require("../../../shared/errorCodes");

/** Comment frames keep proxies and load balancers from idling the connection out. */
const SSE_HEARTBEAT_INTERVAL_MS = 30_000;

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

/**
 * GET /api/accounts/:publicKey/stream
 * Push XLM balance updates to the browser over Server-Sent Events (#157).
 *
 * The current balance is sent as soon as the connection opens, then again
 * every time Horizon reports a payment operation touching the account. A
 * `: heartbeat` comment frame is written every 30 seconds. Horizon is streamed
 * once per account regardless of how many clients are connected, and that
 * stream is closed as soon as the last client disconnects.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 *
 * @returns {200} `text/event-stream` of `balance` and `stream-error` events.
 *   Soft failures use the `stream-error` event name rather than `error`, which
 *   `EventSource` reserves for transport failures.
 */
async function streamBalance(req, res) {
  const { publicKey } = req.params;

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    // Tell nginx not to buffer the response (see nginx/nginx.conf).
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders?.();

  let closed = false;

  const send = (event, data) => {
    if (closed || res.writableEnded) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  send("open", { publicKey });

  const unsubscribe = balanceStreamService.subscribe(publicKey, {
    onBalance: (data) => send("balance", data),
    onError: (data) => send("stream-error", data),
  });

  const heartbeat = setInterval(() => {
    if (closed || res.writableEnded) return;
    res.write(": heartbeat\n\n");
  }, SSE_HEARTBEAT_INTERVAL_MS);
  heartbeat.unref?.();

  const cleanup = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    unsubscribe();
    res.end();
  };

  req.on("close", cleanup);
  res.on("close", cleanup);
  res.on("error", cleanup);

  // Seed the client with the balance as it stands right now, so the dashboard
  // never has to wait for a payment before it can render a value.
  try {
    const xlm = await stellarService.getXLMBalance(publicKey);
    send("balance", { publicKey, xlm, updatedAt: Date.now() });
  } catch (err) {
    logger.error(
      { err, publicKey: String(publicKey).replace(/[\r\n]/g, "") },
      "Failed to send initial balance on SSE stream",
    );
    send("stream-error", {
      message:
        err?.status === 404
          ? "Account not found. It may not be funded yet."
          : "Failed to load the current balance.",
    });
  }
}

module.exports = {
  getAccount,
  getBalance,
  registerUsername,
  resolveUsername,
  streamBalance,
};

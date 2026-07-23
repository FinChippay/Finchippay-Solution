/**
 * src/controllers/turretsController.js
 * HTTP handlers for Stellar Turrets txFunction deployment and monitoring.
 *
 * Turrets are decentralised signers that execute pre-approved transaction
 * functions on behalf of users. This controller exposes the management API
 * for deploying, listing, pausing, and resuming txFunctions on the Finchippay
 * Turrets side-server.
 *
 * All handlers follow the (req, res, next) Express convention and delegate
 * business logic entirely to `turretsService`. Errors are forwarded to the
 * global error handler via `next(err)`.
 */

"use strict";

const turretsService = require("../services/turretsService");

/**
 * POST /api/turrets/challenge
 * Create a signing challenge that the client must sign to prove key ownership.
 *
 * Body: { ownerPublicKey: string, type: string, config: object }
 * Response: { success: true, data: { challenge, expiresAt } }
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
async function createChallenge(req, res, next) {
  try {
    const { ownerPublicKey, type, config } = req.validated;
    const data = await turretsService.createSigningChallenge({
      ownerPublicKey,
      type,
      config,
    });
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/turrets/deploy
 * Deploy a txFunction. Requires the challenge to have been signed.
 *
 * Body: { ownerPublicKey, type, config, deploymentHash, signedChallengeXDR }
 * Response: { success: true, data: DeploymentRecord } — HTTP 201
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
function deploy(req, res, next) {
  try {
    const { ownerPublicKey, type, config, deploymentHash, signedChallengeXDR } =
      req.validated;
    const data = turretsService.deployTxFunction({
      ownerPublicKey,
      type,
      config,
      deploymentHash,
      signedChallengeXDR,
    });
    res.status(201).json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/turrets
 * List all deployments, optionally filtered by owner.
 *
 * Query: { ownerPublicKey?: string }
 * Response: { success: true, data: DeploymentRecord[] }
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
function list(req, res, next) {
  try {
    const { ownerPublicKey } = req.validated;
    const data = turretsService.listDeployments(ownerPublicKey);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/turrets/:id
 * Get a single deployment by ID.
 *
 * Response: { success: true, data: DeploymentRecord }
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
function getOne(req, res, next) {
  try {
    const { id } = req.validated;
    const data = turretsService.getDeployment(id);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/turrets/:id/history
 * Get execution history for a deployment.
 *
 * Response: { success: true, data: ExecutionRecord[] }
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
function getHistory(req, res, next) {
  try {
    const { id } = req.validated;
    turretsService.getDeployment(id); // throws 404 if not found
    const data = turretsService.getExecutionHistory(id);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/turrets/:id/pause
 * Pause a deployment so it stops accepting execution requests.
 *
 * Response: { success: true, data: DeploymentRecord }
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
function pause(req, res, next) {
  try {
    const { id } = req.validated;
    const data = turretsService.setDeploymentStatus(id, "paused");
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/turrets/:id/resume
 * Resume a previously paused deployment.
 *
 * Response: { success: true, data: DeploymentRecord }
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
function resume(req, res, next) {
  try {
    const { id } = req.validated;
    const data = turretsService.setDeploymentStatus(id, "active");
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  createChallenge,
  deploy,
  list,
  getOne,
  getHistory,
  pause,
  resume,
};

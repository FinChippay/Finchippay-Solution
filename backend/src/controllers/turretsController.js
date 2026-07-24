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
 140-issue-18-input-validation-with-zod-schemas-fix
 140-issue-18-input-validation-with-zod-schemas-fix

 160-issue-38-rtl-language-support-arabic-hebrew-fix
 master
    const { ownerPublicKey, type, config } = req.validated;

    const { ownerPublicKey, type, config } = req.body;
 master
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
async function deploy(req, res, next) {
  try {
    const { ownerPublicKey, type, config, deploymentHash, signedChallengeXDR } =
 140-issue-18-input-validation-with-zod-schemas-fix
 140-issue-18-input-validation-with-zod-schemas-fix

 160-issue-38-rtl-language-support-arabic-hebrew-fix
 master
      req.validated;
    const data = turretsService.deployTxFunction({

      req.body;
    const data = await turretsService.deployTxFunction({
 master
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
async function list(req, res, next) {
  try {
 140-issue-18-input-validation-with-zod-schemas-fix
 140-issue-18-input-validation-with-zod-schemas-fix

160-issue-38-rtl-language-support-arabic-hebrew-fix
 master
    const { ownerPublicKey } = req.validated;
    const data = turretsService.listDeployments(ownerPublicKey);

    const { ownerPublicKey } = req.query;
    const data = await turretsService.listDeployments(ownerPublicKey);
 140-issue-18-input-validation-with-zod-schemas-fix
master

 master
 master
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
async function getOne(req, res, next) {
  try {
 140-issue-18-input-validation-with-zod-schemas-fix
 140-issue-18-input-validation-with-zod-schemas-fix

 160-issue-38-rtl-language-support-arabic-hebrew-fix
 master
    const { id } = req.validated;
    const data = turretsService.getDeployment(id);

    const { id } = req.params;
    const data = await turretsService.getDeployment(id);
 master
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
async function getHistory(req, res, next) {
  try {
 140-issue-18-input-validation-with-zod-schemas-fix
 140-issue-18-input-validation-with-zod-schemas-fix

 160-issue-38-rtl-language-support-arabic-hebrew-fix
 master
    const { id } = req.validated;
    turretsService.getDeployment(id); // throws 404 if not found
    const data = turretsService.getExecutionHistory(id);

    const { id } = req.params;
    await turretsService.getDeployment(id); // throws 404 if not found
    const data = await turretsService.getExecutionHistory(id);
 master
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
async function pause(req, res, next) {
  try {
 140-issue-18-input-validation-with-zod-schemas-fix
 140-issue-18-input-validation-with-zod-schemas-fix

 160-issue-38-rtl-language-support-arabic-hebrew-fix
 master
    const { id } = req.validated;
    const data = turretsService.setDeploymentStatus(id, "paused");

    const { id } = req.params;
    const data = await turretsService.setDeploymentStatus(id, "paused");
 master
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
async function resume(req, res, next) {
  try {
 140-issue-18-input-validation-with-zod-schemas-fix
 140-issue-18-input-validation-with-zod-schemas-fix

 160-issue-38-rtl-language-support-arabic-hebrew-fix
 master
    const { id } = req.validated;
    const data = turretsService.setDeploymentStatus(id, "active");

    const { id } = req.params;
    const data = await turretsService.setDeploymentStatus(id, "active");
 master
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

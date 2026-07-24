/**
 * src/controllers/turretsController.js
 * HTTP handlers for Stellar Turrets txFunction deployment and monitoring.
 */

"use strict";

const turretsService = require("../services/turretsService");
const priceFeedService = require("../services/priceFeedService");

async function createChallenge(req, res, next) {
  try {
 #136-Issue-#14-Database-Backed-Turrets-with-Price-Feed-Fallbacks-FIX
    const { ownerPublicKey, type, config } = req.validated || req.body;

 160-issue-38-rtl-language-support-arabic-hebrew-fix
    const { ownerPublicKey, type, config } = req.validated;

    const { ownerPublicKey, type, config } = req.body;
 master
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

 #136-Issue-#14-Database-Backed-Turrets-with-Price-Feed-Fallbacks-FIX
async function deploy(req, res, next) {
  try {
    const { ownerPublicKey, type, config, deploymentHash, signedChallengeXDR } =
      req.validated || req.body;
    const data = await turretsService.deployTxFunction({

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
 160-issue-38-rtl-language-support-arabic-hebrew-fix
      req.validated;
    const data = turretsService.deployTxFunction({

      req.body;
    const data = await turretsService.deployTxFunction({
 master
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

 #136-Issue-#14-Database-Backed-Turrets-with-Price-Feed-Fallbacks-FIX
async function list(req, res, next) {
  try {
    const { ownerPublicKey } = req.validated || req.query;
    const data = await turretsService.listDeployments(ownerPublicKey);

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
160-issue-38-rtl-language-support-arabic-hebrew-fix
    const { ownerPublicKey } = req.validated;
    const data = turretsService.listDeployments(ownerPublicKey);

    const { ownerPublicKey } = req.query;
    const data = await turretsService.listDeployments(ownerPublicKey);
 master
 master
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

 #136-Issue-#14-Database-Backed-Turrets-with-Price-Feed-Fallbacks-FIX
async function getOne(req, res, next) {
  try {
    const { id } = req.validated || req.params;
    const data = await turretsService.getDeployment(id);

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
 160-issue-38-rtl-language-support-arabic-hebrew-fix
    const { id } = req.validated;
    const data = turretsService.getDeployment(id);

    const { id } = req.params;
    const data = await turretsService.getDeployment(id);
 master
 master
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

 #136-Issue-#14-Database-Backed-Turrets-with-Price-Feed-Fallbacks-FIX
async function getHistory(req, res, next) {
  try {
    const { id } = req.validated || req.params;
    await turretsService.getDeployment(id); // throws 404 if not found
    const data = await turretsService.getExecutionHistory(id);

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
 160-issue-38-rtl-language-support-arabic-hebrew-fix
    const { id } = req.validated;
    turretsService.getDeployment(id); // throws 404 if not found
    const data = turretsService.getExecutionHistory(id);

    const { id } = req.params;
    await turretsService.getDeployment(id); // throws 404 if not found
    const data = await turretsService.getExecutionHistory(id);
 master
 master
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

 #136-Issue-#14-Database-Backed-Turrets-with-Price-Feed-Fallbacks-FIX
async function pause(req, res, next) {
  try {
    const { id } = req.validated || req.params;
    const data = await turretsService.setDeploymentStatus(id, "paused");

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
 160-issue-38-rtl-language-support-arabic-hebrew-fix
    const { id } = req.validated;
    const data = turretsService.setDeploymentStatus(id, "paused");

    const { id } = req.params;
    const data = await turretsService.setDeploymentStatus(id, "paused");
 master
 master
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

 #136-Issue-#14-Database-Backed-Turrets-with-Price-Feed-Fallbacks-FIX
async function resume(req, res, next) {
  try {
    const { id } = req.validated || req.params;
    const data = await turretsService.setDeploymentStatus(id, "active");

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
 160-issue-38-rtl-language-support-arabic-hebrew-fix
    const { id } = req.validated;
    const data = turretsService.setDeploymentStatus(id, "active");

    const { id } = req.params;
    const data = await turretsService.setDeploymentStatus(id, "active");
 master
 master
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

async function health(req, res, next) {
  try {
    const priceFeed = await priceFeedService.getHealth();
    const activeDeployments = await turretsService.countDeploymentsByStatus("active");
    res.status(priceFeed.status === "ok" ? 200 : 503).json({
      success: priceFeed.status === "ok",
      service: "turrets",
      status: priceFeed.status,
      activeDeployments,
      priceFeed,
    });
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
  health,
};

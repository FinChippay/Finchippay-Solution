/**
 * src/controllers/turretsController.js
 * HTTP handlers for Stellar Turrets txFunction deployment and monitoring.
 */

"use strict";

const turretsService = require("../services/turretsService");
const priceFeedService = require("../services/priceFeedService");
const {
  paginateInMemory,
  setPaginationHeaders,
  formatPaginatedResponse,
} = require("../utils/paginate");

/**
 * POST /api/turrets/challenge
 * Create a signing challenge for a new txFunction deployment.
 *
 * Body: { ownerPublicKey, type, config }
 * Response: { success: true, data: ChallengeRecord }
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
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
async function deploy(req, res, next) {
  try {
    const { ownerPublicKey, type, config, deploymentHash, signedChallengeXDR } = req.validated;
    const data = await turretsService.deployTxFunction({
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
 * Query: { ownerPublicKey?: string, limit?: number, cursor?: string }
 * Response: { success: true, data: DeploymentRecord[], pagination }
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
async function list(req, res, next) {
  try {
    const ownerPublicKey =
      req.validated?.ownerPublicKey || req.query.ownerPublicKey || req.params?.ownerPublicKey;
    const rawData = await turretsService.listDeployments(ownerPublicKey);
    const limit = req.pagination?.limit || Math.min(parseInt(req.query.limit) || 20, 100);
    const cursor = req.pagination?.cursor || null;

    const { data, nextCursor, total } = paginateInMemory(
      rawData || [],
      { limit, cursor },
      (d) => ({ id: d.id }),
      (a, b) => String(b.id || "").localeCompare(String(a.id || "")),
    );

    setPaginationHeaders(req, res, { nextCursor, total, limit });
    res.json(formatPaginatedResponse(data, nextCursor, total, { limit }));
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
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
async function getOne(req, res, next) {
  try {
    const { id } = req.validated || req.params;
    const data = await turretsService.getDeployment(id);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/turrets/:id/history
 * Get execution history for a deployment.
 *
 * Response: { success: true, data: ExecutionRecord[], pagination }
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
async function getHistory(req, res, next) {
  try {
    const { id } = req.validated || req.params;
    await turretsService.getDeployment(id); // throws 404 if not found
    const rawData = await turretsService.getExecutionHistory(id);
    const limit = req.pagination?.limit || Math.min(parseInt(req.query.limit) || 20, 100);
    const cursor = req.pagination?.cursor || null;

    const { data, nextCursor, total } = paginateInMemory(
      rawData || [],
      { limit, cursor },
      (h) => ({ id: h.id || h.timestamp }),
      (a, b) => (b.timestamp || 0) - (a.timestamp || 0),
    );

    setPaginationHeaders(req, res, { nextCursor, total, limit });
    res.json(formatPaginatedResponse(data, nextCursor, total, { limit }));
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
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
async function pause(req, res, next) {
  try {
    const { id } = req.validated;
    const data = await turretsService.setDeploymentStatus(id, "paused");
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
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
async function resume(req, res, next) {
  try {
    const { id } = req.validated;
    const data = await turretsService.setDeploymentStatus(id, "active");
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

/** GET /api/turrets/health — service-level health check for the turrets subsystem. */
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

/**
 * src/controllers/turretsController.js
 * HTTP handlers for Stellar Turrets txFunction deployment and monitoring.
 */

"use strict";

const turretsService = require("../services/turretsService");
const priceFeedService = require("../services/priceFeedService");

async function createChallenge(req, res, next) {
  try {
    const { ownerPublicKey, type, config } = req.validated || req.body;
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

async function deploy(req, res, next) {
  try {
    const { ownerPublicKey, type, config, deploymentHash, signedChallengeXDR } =
      req.validated || req.body;
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

async function list(req, res, next) {
  try {
    const { ownerPublicKey } = req.validated || req.query;
    const data = await turretsService.listDeployments(ownerPublicKey);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

async function getOne(req, res, next) {
  try {
    const { id } = req.validated || req.params;
    const data = await turretsService.getDeployment(id);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

async function getHistory(req, res, next) {
  try {
    const { id } = req.validated || req.params;
    await turretsService.getDeployment(id); // throws 404 if not found
    const data = await turretsService.getExecutionHistory(id);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

async function pause(req, res, next) {
  try {
    const { id } = req.validated || req.params;
    const data = await turretsService.setDeploymentStatus(id, "paused");
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

async function resume(req, res, next) {
  try {
    const { id } = req.validated || req.params;
    const data = await turretsService.setDeploymentStatus(id, "active");
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

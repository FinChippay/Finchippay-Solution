/**
 * src/routes/turrets.js
 * Turrets txFunctions API routes.
 */

"use strict";

const express = require("express");
const { strictLimiter } = require("../middleware/rateLimit");
const { verifyJWT } = require("../middleware/auth");
const { validate } = require("../validation/middleware");
const {
  turretChallengeSchema,
  turretDeploySchema,
  turretsListQuerySchema,
  idParamSchema,
} = require("../validation/schemas");
const controller = require("../controllers/turretsController");
const turretsService = require("../services/turretsService");
const { sendError } = require("../utils/errorResponse");

const router = express.Router();

/**
 * Verify the authenticated user owns the turret deployment identified by
 * :id route parameter. Looks up the deployment, then checks ownership.
 * Must run after verifyJWT.
 */
async function requireOwnTurret(req, res, next) {
  try {
    const deployment = await turretsService.getDeployment(req.validated?.id || req.params.id);
    if (!deployment) {
      return sendError(res, "RES_NOT_FOUND", {
        details: { resourceType: "turret", id: req.validated?.id || req.params.id },
      });
    }
    if (req.user?.publicKey !== deployment.ownerPublicKey) {
      return sendError(res, "AUTH_FORBIDDEN", {
        message: "Forbidden: you may only access your own turret deployments.",
      });
    }
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Verify the authenticated user matches the ownerPublicKey in the request body
 * (used by challenge and deploy endpoints). Must run after verifyJWT.
 */
function requireMatchingOwner(req, res, next) {
  const ownerPublicKey = req.validated?.ownerPublicKey;
  if (!ownerPublicKey || req.user?.publicKey !== ownerPublicKey) {
    return sendError(res, "AUTH_FORBIDDEN", {
      message: "Forbidden: you may only deploy turrets for your own account.",
    });
  }
  next();
}

router.get("/", strictLimiter, verifyJWT, controller.list);
router.post(
  "/challenge",
  strictLimiter,
  verifyJWT,
  validate(turretChallengeSchema),
  requireMatchingOwner,
  controller.createChallenge,
);
router.post(
  "/deploy",
  strictLimiter,
  verifyJWT,
  validate(turretDeploySchema),
  requireMatchingOwner,
  controller.deploy,
);
router.get("/health", strictLimiter, controller.health);
router.get(
  "/:id",
  strictLimiter,
  verifyJWT,
  async (req, res, next) => {
  if (
    typeof req.params.id === "string" &&
    req.params.id.startsWith("G") &&
    req.params.id.length === 56
  ) {
    req.query.ownerPublicKey = req.params.id;
    return controller.list(req, res, next);
  }
  return controller.getOne(req, res, next);
});
router.get("/:id/history", strictLimiter, verifyJWT, validate(idParamSchema, "params"), async (req, res, next) => {
  // The :id could be a deployment ID — verify ownership first
  try {
    const deployment = await turretsService.getDeployment(req.validated?.id || req.params.id);
    if (req.user?.publicKey !== deployment.ownerPublicKey) {
      return sendError(res, "AUTH_FORBIDDEN", {
        message: "Forbidden: you may only access your own turret data.",
      });
    }
  } catch (err) {
    return next(err);
  }
  return controller.getHistory(req, res, next);
});
router.post("/:id/pause", strictLimiter, verifyJWT, validate(idParamSchema, "params"), requireOwnTurret, controller.pause);
router.post("/:id/resume", strictLimiter, verifyJWT, validate(idParamSchema, "params"), requireOwnTurret, controller.resume);

module.exports = router;

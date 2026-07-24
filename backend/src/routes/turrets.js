/**
 * src/routes/turrets.js
 * Turrets txFunctions API routes.
 */

"use strict";

const express = require("express");
const { strictLimiter } = require("../middleware/rateLimit");
const { validate } = require("../validation/middleware");
const {
  turretChallengeSchema,
  turretDeploySchema,
  turretsListQuerySchema,
  idParamSchema,
} = require("../validation/schemas");
const controller = require("../controllers/turretsController");

const router = express.Router();

router.get(
  "/",
  strictLimiter,
  validate(turretsListQuerySchema, "query"),
  controller.list,
);
router.post(
  "/challenge",
  strictLimiter,
  validate(turretChallengeSchema),
  controller.createChallenge,
);
router.post(
  "/deploy",
  strictLimiter,
  validate(turretDeploySchema),
  controller.deploy,
);
router.get("/health", strictLimiter, controller.health);
router.get(
  "/:id",
  strictLimiter,
  validate(idParamSchema, "params"),
  controller.getOne,
);
router.get(
  "/:id/history",
  strictLimiter,
  validate(idParamSchema, "params"),
  controller.getHistory,
);
router.post(
  "/:id/pause",
  strictLimiter,
  validate(idParamSchema, "params"),
  controller.pause,
);
router.post(
  "/:id/resume",
  strictLimiter,
  validate(idParamSchema, "params"),
  controller.resume,
);

module.exports = router;

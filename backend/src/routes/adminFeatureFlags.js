/**
 * src/routes/adminFeatureFlags.js
 * Admin-only feature flag management routes.
 *
 * Mounted at: /api/admin/feature-flags
 * All routes require a valid JWT (verifyJWT middleware).
 */

"use strict";

const express    = require("express");
const router     = express.Router();
const { strictLimiter } = require("../middleware/rateLimit");
const { verifyJWT }     = require("../middleware/auth");
const featureFlagsController = require("../controllers/featureFlagsController");

/**
 * GET /api/admin/feature-flags
 * List all flags with full metadata and current evaluated state.
 * Requires a valid JWT.
 */
router.get(
  "/",
  strictLimiter,
  verifyJWT,
  featureFlagsController.adminGetFlags
);

/**
 * POST /api/admin/feature-flags/:key/toggle
 * Toggle a flag on, off, or reset to config default.
 * Body: { "enabled": true | false | null }
 * Requires a valid JWT.
 */
router.post(
  "/:key/toggle",
  strictLimiter,
  verifyJWT,
  featureFlagsController.adminToggleFlag
);

module.exports = router;

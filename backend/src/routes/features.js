/**
 * src/routes/features.js
 * Public feature flags route — returns evaluated flag state for the frontend.
 *
 * Mounted at: GET /api/features
 */

"use strict";

const express    = require("express");
const router     = express.Router();
const { strictLimiter } = require("../middleware/rateLimit");
const featureFlagsController = require("../controllers/featureFlagsController");

/**
 * GET /api/features
 * Returns a flat { key: boolean } map for all flags, evaluated in the
 * current server environment. No auth required.
 */
router.get("/", strictLimiter, featureFlagsController.getClientFlags);

module.exports = router;

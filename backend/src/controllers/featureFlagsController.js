/**
 * src/controllers/featureFlagsController.js
 * HTTP handlers for feature flag endpoints.
 *
 * Routes handled:
 *   GET  /api/features                       → client-facing evaluated flag map
 *   GET  /api/admin/feature-flags            → full flag list with metadata (admin)
 *   POST /api/admin/feature-flags/:key/toggle → toggle a flag on/off (admin)
 */

"use strict";

const featureFlagsService = require("../services/featureFlagsService");

/**
 * GET /api/features
 * Public endpoint — returns a flat { key: boolean } map for all flags
 * evaluated in the current environment. Used by the frontend provider to
 * merge server-side state with local defaults.
 *
 * No auth required; no sensitive flag metadata is exposed.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
async function getClientFlags(req, res, next) {
  try {
    const features = featureFlagsService.getFlagsForClient();
    res.json({ success: true, features });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/admin/feature-flags
 * Admin endpoint — returns full flag definitions including metadata,
 * environment toggles, rollout percentage, and current evaluated state.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
async function adminGetFlags(req, res, next) {
  try {
    const flags = featureFlagsService.getAllFlags();
    res.json({ success: true, data: { flags, count: flags.length } });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/admin/feature-flags/:key/toggle
 * Admin endpoint — toggle a flag on, off, or reset to config default.
 *
 * Request body:
 *   { "enabled": true | false | null }
 *   - true  → force flag on  (runtime override)
 *   - false → force flag off (runtime override)
 *   - null  → remove override, revert to config evaluation
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
async function adminToggleFlag(req, res, next) {
  try {
    const { key } = req.params;

    if (!key || typeof key !== "string") {
      return res.status(400).json({
        success: false,
        error: { code: "VAL_INVALID_INPUT", message: "Flag key is required." },
      });
    }

    const { enabled } = req.body;

    if (enabled !== true && enabled !== false && enabled !== null) {
      return res.status(400).json({
        success: false,
        error: {
          code: "VAL_INVALID_INPUT",
          message: "Body must include \"enabled\" as true, false, or null.",
        },
      });
    }

    const updated = featureFlagsService.toggleFlag(key, enabled);

    if (!updated) {
      return res.status(404).json({
        success: false,
        error: { code: "NOT_FOUND", message: `Feature flag "${key}" not found.` },
      });
    }

    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
}

module.exports = { getClientFlags, adminGetFlags, adminToggleFlag };

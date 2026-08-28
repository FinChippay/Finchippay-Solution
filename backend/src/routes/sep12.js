/**
 * src/routes/sep12.js
 * SEP-0012 (KYC API) route handlers.
 *
 * POST   /api/sep12/customer        — submit KYC fields
 * GET    /api/sep12/customer        — fetch KYC data and status
 * GET    /api/sep12/customer/status — return simplified status
 */

"use strict";

const express = require("express");
const router = express.Router();
const sep12Service = require("../services/sep12Service");
const { verifyJWT } = require("../middleware/auth");
const { sensitiveLimiter } = require("../middleware/rateLimit");
const { sendError } = require("../utils/errorResponse");
const { validate } = require("../validation/middleware");
const { sep12CustomerBodySchema, sep12CustomerQuerySchema } = require("../validation/schemas");

/**
 * POST /api/sep12/customer
 *
 * Submit KYC fields to the configured anchor.
 */
router.post(
  "/customer",
  verifyJWT,
  sensitiveLimiter,
  validate(sep12CustomerBodySchema),
  async (req, res, next) => {
    try {
      const publicKey = req.user?.publicKey;
      if (!publicKey) {
        return sendError(res, "AUTH_INVALID_TOKEN", {
          message: "Unauthorized: the token carries no publicKey.",
        });
      }

      const { anchorName, fields } = req.validated;

      const authHeader = req.headers.authorization;
      const jwt = authHeader?.startsWith("Bearer ") ? authHeader.split(" ")[1] : undefined;

      const record = await sep12Service.putCustomer(publicKey, anchorName, fields, jwt);

      res.json({
        success: true,
        data: {
          publicKey: record.publicKey,
          anchorName: record.anchorName,
          status: record.status,
          fields: record.fields,
          message: record.message,
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * GET /api/sep12/customer
 *
 * Fetch current KYC data and status from the anchor.
 */
router.get(
  "/customer",
  verifyJWT,
  sensitiveLimiter,
  validate(sep12CustomerQuerySchema, "query"),
  async (req, res, next) => {
    try {
      const publicKey = req.user?.publicKey;
      if (!publicKey) {
        return sendError(res, "AUTH_INVALID_TOKEN", {
          message: "Unauthorized: the token carries no publicKey.",
        });
      }

      const { anchorName } = req.validated;

      const authHeader = req.headers.authorization;
      const jwt = authHeader?.startsWith("Bearer ") ? authHeader.split(" ")[1] : undefined;

      const record = await sep12Service.getCustomer(publicKey, anchorName, jwt);

      res.json({
        success: true,
        data: {
          publicKey: record.publicKey,
          anchorName: record.anchorName,
          status: record.status,
          fields: record.fields,
          message: record.message,
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * GET /api/sep12/customer/status
 *
 * Return simplified KYC status for a user + anchor pair.
 */
router.get(
  "/customer/status",
  verifyJWT,
  sensitiveLimiter,
  validate(sep12CustomerQuerySchema, "query"),
  async (req, res, next) => {
    try {
      const publicKey = req.user?.publicKey;
      if (!publicKey) {
        return sendError(res, "AUTH_INVALID_TOKEN", {
          message: "Unauthorized: the token carries no publicKey.",
        });
      }

      const { anchorName } = req.validated;

      const authHeader = req.headers.authorization;
      const jwt = authHeader?.startsWith("Bearer ") ? authHeader.split(" ")[1] : undefined;

      const status = await sep12Service.getCustomerStatus(publicKey, anchorName, jwt);

      res.json({ success: true, data: status });
    } catch (err) {
      next(err);
    }
  },
);

module.exports = router;

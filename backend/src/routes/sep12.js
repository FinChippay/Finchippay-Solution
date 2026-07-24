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

// ─── POST /api/sep12/customer ────────────────────────────────────────────────

/**
 * Submit KYC fields to the configured anchor.
 *
 * Headers:
 *   - Authorization: Bearer <SEP-0010 JWT>  (required)
 *
 * Body (JSON):
 *   - anchorName  (string, required)  — e.g. "anchorusd_testnet"
 *   - fields      (object, required)  — { first_name, last_name, email, address, ... }
 *
 * Response 200:
 *   { success: true, data: { publicKey, anchorName, status, fields, message } }
 */
router.post(
  "/customer",
  verifyJWT,
  sensitiveLimiter,
  async (req, res, next) => {
    try {
      const publicKey = req.user?.publicKey;
      if (!publicKey) {
        return sendError(res, "AUTH_INVALID_TOKEN", {
          message: "Unauthorized: the token carries no publicKey.",
        });
      }

      const { anchorName, fields } = req.body;

      if (!anchorName) {
        return sendError(res, "VAL_MISSING_FIELD", {
          details: { fields: ["anchorName"] },
        });
      }

      if (!fields || typeof fields !== "object") {
        return sendError(res, "VAL_MISSING_FIELD", {
          details: { fields: ["fields"] },
        });
      }

      const authHeader = req.headers.authorization;
      const jwt = authHeader?.startsWith("Bearer ")
        ? authHeader.split(" ")[1]
        : undefined;

      const record = await sep12Service.putCustomer(
        publicKey,
        anchorName,
        fields,
        jwt,
      );

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

// ─── GET /api/sep12/customer ─────────────────────────────────────────────────

/**
 * Fetch current KYC data and status from the anchor.
 *
 * Headers:
 *   - Authorization: Bearer <SEP-0010 JWT>  (required)
 *
 * Query params:
 *   - anchorName  (string, required)
 *
 * Response 200:
 *   { success: true, data: { publicKey, anchorName, status, fields, message } }
 */
router.get("/customer", verifyJWT, sensitiveLimiter, async (req, res, next) => {
  try {
    const publicKey = req.user?.publicKey;
    if (!publicKey) {
      return sendError(res, "AUTH_INVALID_TOKEN", {
        message: "Unauthorized: the token carries no publicKey.",
      });
    }

    const { anchorName } = req.query;
    if (!anchorName) {
      return sendError(res, "VAL_INVALID_QUERY_PARAM", {
        message: "The anchorName query parameter is required.",
        details: { parameter: "anchorName" },
      });
    }

    const authHeader = req.headers.authorization;
    const jwt = authHeader?.startsWith("Bearer ")
      ? authHeader.split(" ")[1]
      : undefined;

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
});

// ─── GET /api/sep12/customer/status ──────────────────────────────────────────

/**
 * Return simplified KYC status for a user + anchor pair.
 * Does NOT call the anchor — returns the cached status from the last
 * PUT or GET.
 *
 * Headers:
 *   - Authorization: Bearer <SEP-0010 JWT>  (required)
 *
 * Query params:
 *   - anchorName  (string, required)
 *
 * Response 200:
 *   { success: true, data: { status: "ACCEPTED"|"PROCESSING"|"NEEDS_INFO"|"REJECTED"|"NONE", message?: string } }
 */
router.get(
  "/customer/status",
  verifyJWT,
  sensitiveLimiter,
  async (req, res, next) => {
    try {
      const publicKey = req.user?.publicKey;
      if (!publicKey) {
        return sendError(res, "AUTH_INVALID_TOKEN", {
          message: "Unauthorized: the token carries no publicKey.",
        });
      }

      const { anchorName } = req.query;
      if (!anchorName) {
        return sendError(res, "VAL_INVALID_QUERY_PARAM", {
          message: "The anchorName query parameter is required.",
          details: { parameter: "anchorName" },
        });
      }

      const authHeader = req.headers.authorization;
      const jwt = authHeader?.startsWith("Bearer ")
        ? authHeader.split(" ")[1]
        : undefined;

      const status = await sep12Service.getCustomerStatus(
        publicKey,
        anchorName,
        jwt,
      );

      res.json({ success: true, data: status });
    } catch (err) {
      next(err);
    }
  },
);

module.exports = router;

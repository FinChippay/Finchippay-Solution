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
        return res
          .status(401)
          .json({ error: "Unauthorized: missing publicKey in token" });
      }

      const { anchorName, fields } = req.body;

      if (!anchorName) {
        return res.status(400).json({ error: "anchorName is required" });
      }

      if (!fields || typeof fields !== "object") {
        return res.status(400).json({ error: "fields object is required" });
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
      return res
        .status(401)
        .json({ error: "Unauthorized: missing publicKey in token" });
    }

    const { anchorName } = req.query;
    if (!anchorName) {
      return res
        .status(400)
        .json({ error: "anchorName query parameter is required" });
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
        return res
          .status(401)
          .json({ error: "Unauthorized: missing publicKey in token" });
      }

      const { anchorName } = req.query;
      if (!anchorName) {
        return res
          .status(400)
          .json({ error: "anchorName query parameter is required" });
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

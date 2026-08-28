/**
 * src/routes/tokens.js
 * Express routes for token portfolio data (issue #362).
 */

"use strict";

const express = require("express");
const router = express.Router();
const tokenPriceService = require("../services/tokenPriceService");
const { validate } = require("../validation/middleware");
const {
  tokenContractIdParamSchema,
  tokenPriceHistoryQuerySchema,
} = require("../validation/schemas");

/**
 * GET /api/v1/tokens/:contractId/price-history?range=7d|30d|90d
 * Returns cached price history (5 min TTL) for a token identified by its
 * Soroban contract ID. Unknown contract IDs return an empty `prices` array
 * rather than an error.
 */
router.get(
  "/:contractId/price-history",
  validate(tokenContractIdParamSchema, "params"),
  validate(tokenPriceHistoryQuerySchema, "query"),
  async (req, res, next) => {
    try {
      const { contractId } = req.validated;
      const { range } = req.validated;
      const history = await tokenPriceService.getPriceHistory(contractId, range);
      res.json(history);
    } catch (err) {
      next(err);
    }
  },
);

// SIP-010 token metadata endpoint
const tokenMetadataService = require("../services/tokenMetadataService");
const { tokenContractIdParamSchema: contractParam } = require("../validation/schemas");

router.get("/:contractId/metadata", validate(contractParam, "params"), async (req, res, next) => {
  try {
    const { contractId } = req.validated;
    const meta = await tokenMetadataService.getTokenMetadata(contractId);
    res.json({ success: true, data: meta });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

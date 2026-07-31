/**
 * src/routes/federation.js
 * Federation endpoints per SEP-0002.
 */

"use strict";

const express = require("express");
const router = express.Router();
const { strictLimiter } = require("../middleware/rateLimit");
const { validate } = require("../validation/middleware");
const { federationQuerySchema } = require("../validation/schemas");
const federationController = require("../controllers/federationController");

/**
 * GET /federation?q=<query>&type=<type>
 * Federation endpoint per SEP-0002.
 * type=name: resolve stellar address to account ID
 * type=id: resolve account ID to stellar address
 */
router.get(
  "/",
  strictLimiter,
  validate(federationQuerySchema, "query"),
  federationController.resolveFederation,
);

module.exports = router;

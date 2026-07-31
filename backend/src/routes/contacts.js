/**
 * src/routes/contacts.js
 * Contact sync API endpoints.
 */

"use strict";

const express = require("express");
const router = express.Router();
const { strictLimiter } = require("../middleware/rateLimit");
const { validate } = require("../validation/middleware");
const { contactSyncSchema } = require("../validation/schemas");
const contactController = require("../controllers/contactController");

/**
 * GET /contacts/:publicKey
 * Fetch all contacts and groups for a given public key.
 */
router.get("/:publicKey", strictLimiter, contactController.getContacts);

/**
 * POST /contacts/:publicKey/sync
 * Bulk upsert contacts and groups.
 */
router.post(
  "/:publicKey/sync",
  strictLimiter,
  validate(contactSyncSchema, "body"),
  contactController.syncContacts,
);

module.exports = router;

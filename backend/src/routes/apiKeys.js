"use strict";

const express = require("express");
const { verifyJWT } = require("../middleware/auth");
const { strictLimiter } = require("../middleware/rateLimit");
const apiKeyService = require("../services/apiKeyService");
const { sendError } = require("../utils/errorResponse");

const router = express.Router();

router.post("/", strictLimiter, verifyJWT, async (req, res) => {
  const { scopes, publicKeys } = req.body || {};
  const allowedPublicKeys = Array.isArray(publicKeys) ? publicKeys : [req.user.publicKey];
  if (
    allowedPublicKeys.length === 0 ||
    allowedPublicKeys.some((publicKey) => publicKey !== req.user.publicKey)
  ) {
    return sendError(res, "AUTH_FORBIDDEN", {
      message: "API keys may only be created for accounts authorized by the authenticated user.",
    });
  }
  try {
    const created = await apiKeyService.createKey(req.user.publicKey, scopes, allowedPublicKeys);
    return res.status(201).json({
      success: true,
      key: created.key,
      apiKey: {
        id: created.id,
        prefix: created.prefix,
        scopes: created.scopes,
        publicKeys: created.publicKeys,
        publicKey: created.publicKey,
        createdAt: created.createdAt,
      },
    });
  } catch (err) {
    return sendError(res, "VAL_INVALID_QUERY_PARAM", { message: err.message });
  }
});

router.get("/", strictLimiter, verifyJWT, async (req, res, next) => {
  try {
    return res.json({ success: true, keys: await apiKeyService.listKeys(req.user.publicKey) });
  } catch (err) {
    return next(err);
  }
});

router.delete("/:id", strictLimiter, verifyJWT, async (req, res, next) => {
  try {
    const revoked = await apiKeyService.revokeKey(req.user.publicKey, req.params.id);
    if (!revoked) return sendError(res, "RES_NOT_FOUND");
    return res.json({ success: true, message: "API key revoked." });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;

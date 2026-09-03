"use strict";

const { formatErrorResponse } = require("../../../shared/errorCodes");
const apiKeyService = require("../services/apiKeyService");
const { apiKeyLimiter } = require("./rateLimit");

function apiKeyAuth(requiredScope = null) {
  return async (req, res, next) => {
    const rawKey = req.get("X-API-Key");
    if (!rawKey) return res.status(401).json(formatErrorResponse("AUTH_MISSING_HEADER"));

    const apiKey = await apiKeyService.findByKey(rawKey);
    if (!apiKey) return res.status(401).json(formatErrorResponse("AUTH_INVALID_TOKEN"));

    if (requiredScope === "read" && !apiKey.hasScope("read") && !apiKey.hasScope("payments:send")) {
      return res.status(403).json(formatErrorResponse("AUTH_FORBIDDEN"));
    }
    if (requiredScope && requiredScope !== "read" && !apiKey.hasScope(requiredScope)) {
      return res.status(403).json(formatErrorResponse("AUTH_FORBIDDEN"));
    }

    if (requiredScope === "payments:send") {
      const requestedPublicKey =
        req.body?.publicKey || req.body?.sourcePublicKey || req.body?.senderPublicKey;
      if (!requestedPublicKey || !apiKey.allowsPublicKey(requestedPublicKey)) {
        return res.status(403).json(formatErrorResponse("AUTH_FORBIDDEN"));
      }
    }

    req.apiKey = apiKey;
    req.user = req.user || { publicKey: apiKey.publicKey, sub: apiKey.publicKey };
    return apiKeyLimiter(req, res, next);
  };
}

module.exports = { apiKeyAuth };

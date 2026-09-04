"use strict";

const { verifyJWT } = require("./auth");
const { apiKeyAuth } = require("./apiKeyAuth");

function combinedAuth(scope) {
  return (req, res, next) => {
    if (req.get("X-API-Key")) return apiKeyAuth(scope)(req, res, next);
    return verifyJWT(req, res, next);
  };
}

module.exports = { combinedAuth };

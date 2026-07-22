/**
 * src/routes/health.js
 * Health check endpoint — used by CI and deployment probes.
 */

"use strict";

const express = require("express");
const router = express.Router();

let getRedisStatus = null;
try {
  getRedisStatus = require("../services/cacheService").getRedisStatus;
} catch {
  // cacheService may not be loaded yet (circular dep avoidance)
}

router.get("/", (req, res) => {
  const health = {
    status: "ok",
    service: "finchippay-api",
    network: process.env.STELLAR_NETWORK || "testnet",
    timestamp: new Date().toISOString(),
    redis: getRedisStatus ? getRedisStatus() : "disabled",
  };
  res.json(health);
});

module.exports = router;

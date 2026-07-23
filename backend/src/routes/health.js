/**
 * src/routes/health.js
 * Health check endpoints — used by CI, load-balancers, and Kubernetes probes.
 *
 * GET /health        — liveness probe (no external I/O, always fast).
 * GET /health/ready  — readiness probe (deep check of downstream dependencies).
 */

"use strict";

const express = require("express");
const { checkDependencies } = require("../services/healthService");

const router = express.Router();

// Optional Redis status — loaded lazily to avoid circular dependency issues.
let getRedisStatus = null;
try {
  getRedisStatus = require("../services/cacheService").getRedisStatus;
} catch {
  // cacheService not available; redis field will report "disabled".
}

/**
 * @swagger
 * /health:
 *   get:
 *     summary: Liveness check
 *     description: >
 *       Lightweight check — no external calls. Returns 200 as long as the
 *       Node.js process is alive. Use as a Kubernetes livenessProbe.
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: Service is alive.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: ok
 *                 service:
 *                   type: string
 *                   example: finchippay-api
 *                 network:
 *                   type: string
 *                   example: testnet
 *                 uptime:
 *                   type: number
 *                   description: Process uptime in seconds.
 *                   example: 123.4
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *                 redis:
 *                   type: string
 *                   example: connected
 */
router.get("/", (_req, res) => {
  res.json({
    status: "ok",
    service: "finchippay-api",
    network: process.env.STELLAR_NETWORK || "testnet",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    redis: getRedisStatus ? getRedisStatus() : "disabled",
  });
});

/**
 * @swagger
 * /health/ready:
 *   get:
 *     summary: Readiness check
 *     description: >
 *       Deep check — probes all downstream dependencies (Horizon, Soroban RPC
 *       when configured). Returns 200 when all dependencies are reachable;
 *       returns 503 when any dependency is down. Use as a Kubernetes
 *       readinessProbe so traffic is only routed to healthy pods.
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: All dependencies are reachable.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ReadinessResponse'
 *       503:
 *         description: One or more dependencies are unreachable.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ReadinessResponse'
 */
router.get("/ready", async (_req, res, next) => {
  try {
    const { healthy, dependencies } = await checkDependencies();
    const statusCode = healthy ? 200 : 503;
    res.status(statusCode).json({
      status: healthy ? "ok" : "error",
      dependencies,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

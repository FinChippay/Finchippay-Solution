/**
 * src/routes/health.js
 * Health check endpoints — used by CI, load balancers, and Kubernetes probes.
 *
 * GET /health              — legacy liveness alias, kept for existing infra
 *                             (docker-compose healthchecks, nginx upstream checks)
 *                             that already poll this exact path.
 * GET /health/live         — liveness probe (process + event loop only).
 * GET /health/ready        — readiness probe (deep dependency checks).
 * GET /health/started      — startup probe (migrations/executor/indexer).
 * GET /health/dependencies — admin-only detailed dependency status page.
 */

"use strict";

const express = require("express");
const healthService = require("../services/healthService");
const shutdownState = require("../services/shutdownState");
const { verifyJWT, requireAdmin } = require("../middleware/auth");

const router = express.Router();

// Process start time, captured at module load (this file is required near
// the top of server.js, so the drift from true process start is negligible).
// Used to report initDuration on the startup probe.
const PROCESS_STARTED_AT = Date.now();

// Optional Redis status — loaded lazily to avoid circular dependency issues.
let getRedisStatus = null;
try {
  getRedisStatus = require("../services/cacheService").getRedisStatus;
} catch {
  // cacheService not available; redis field will report "disabled".
}

// Dependencies considered critical for readiness: if any is unhealthy the
// pod is pulled out of rotation. Soroban RPC and disk space can degrade
// without blocking traffic, so they aren't in this list.
const CRITICAL_CHECK_KEYS = ["postgres", "redis", "horizon"];

/**
 * GET /health
 * Legacy liveness alias — no external calls, returns 200 as long as the
 * Node.js process is alive. Kept for existing infra (docker-compose,
 * nginx) that polls this exact path.
 */
router.get("/", (_req, res) => {
  res.json({
    status: "ok",
    service: "finchippay-api",
    API_VERSION: process.env.API_VERSION || "v1",
    network: process.env.STELLAR_NETWORK || "testnet",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    redis: getRedisStatus ? getRedisStatus() : "disabled",
  });
});

/**
 * GET /health/live
 * Kubernetes livenessProbe. Only checks process responsiveness (event loop
 * lag) — no external I/O, so a slow dependency never triggers a pod
 * restart. Returns 503 only when the event loop itself is wedged, which is
 * the one condition a restart can actually fix.
 */
router.get("/live", async (_req, res, next) => {
  try {
    const eventLoop = await healthService.checkEventLoop();
    const alive = eventLoop.status !== "unhealthy";

    res.status(alive ? 200 : 503).json({
      status: alive ? "alive" : "unhealthy",
      uptime: process.uptime(),
      eventLoop,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /health/ready
 * Kubernetes readinessProbe. Returns 200 only when every critical
 * dependency (PostgreSQL, Redis, Horizon) is at least 'degraded' (not
 * 'unhealthy'). Soroban RPC and disk space can be 'degraded' without
 * failing readiness — they're reported so operators can see early warning
 * signs, but they don't stop traffic.
 */
router.get("/ready", async (_req, res, next) => {
  try {
    if (shutdownState.isShuttingDown()) {
      return res.status(503).json({
        status: "not_ready",
        checks: {},
        summary: "critical_failure",
      });
    }

    const [postgres, redis, horizon, sorobanRpc, diskSpace] = await Promise.all([
      healthService.checkPostgres(),
      healthService.checkRedis(),
      healthService.checkHorizon(),
      healthService.checkSorobanRpc(),
      healthService.checkDiskSpace(),
    ]);

    const checks = {
      postgres,
      redis,
      horizon,
      soroban_rpc: sorobanRpc,
      disk_space: diskSpace,
    };

    const criticalFailure = CRITICAL_CHECK_KEYS.some((key) => checks[key].status === "unhealthy");
    const anyDegraded = Object.values(checks).some((c) => c.status !== "healthy");

    const summary = criticalFailure ? "critical_failure" : anyDegraded ? "degraded" : "all_healthy";

    res.status(criticalFailure ? 503 : 200).json({
      status: criticalFailure ? "not_ready" : "ready",
      checks,
      summary,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /health/started
 * Kubernetes startupProbe. Returns 200 once boot-time initialisation has
 * completed: migrations applied, the scheduled-transaction executor
 * running, and the event indexer running (or intentionally disabled when
 * no CONTRACT_ID is configured).
 */
router.get("/started", async (_req, res, next) => {
  try {
    const { started, checks } = await healthService.checkStartupComplete();

    res.status(started ? 200 : 503).json({
      status: started ? "started" : "starting",
      checks,
      initDuration: Date.now() - PROCESS_STARTED_AT,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /health/dependencies
 * Admin-only detailed status of every dependency, with latency and a
 * shared last-checked timestamp. Intended for operator debugging, not for
 * automated probes.
 */
router.get("/dependencies", verifyJWT, requireAdmin, async (_req, res, next) => {
  try {
    const results = await healthService.runAllChecks();
    const checkedAt = new Date().toISOString();

    const dependencies = Object.fromEntries(
      Object.entries(results).map(([name, result]) => [name, { ...result, checkedAt }]),
    );

    res.json({ dependencies });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

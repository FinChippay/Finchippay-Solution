/**
 * src/services/healthService.js
 * Dependency probes backing the liveness, readiness, startup, and
 * dependency-status endpoints in ../routes/health.js.
 *
 * Every check* function resolves to the same shape:
 *   { status: 'healthy'|'degraded'|'unhealthy', latency: number, message: string }
 * so callers can aggregate them uniformly regardless of what's being probed.
 * "latency" is always in milliseconds. Checks never throw — a failed probe
 * (timeout, connection error, missing config) is reported as 'unhealthy'
 * rather than rejecting, so Promise.all() over the whole set never short-circuits.
 *
 * Thresholds are configurable via env vars so ops can tune sensitivity per
 * deployment without a code change (e.g. a slower staging DB shouldn't page).
 */

"use strict";

const https = require("https");
const http = require("http");
const fsp = require("fs/promises");
const knex = require("../db");
const cacheService = require("./cacheService");
const scheduledExecutor = require("./scheduledExecutor");
const eventIndexer = require("./eventIndexer");
const logger = require("../utils/logger");

const HEALTH_TIMEOUT_MS = parseInt(process.env.HEALTH_TIMEOUT_MS, 10) || 5_000;

const POSTGRES_DEGRADED_LATENCY_MS = parseInt(process.env.POSTGRES_DEGRADED_LATENCY_MS, 10) || 200;
const REDIS_DEGRADED_LATENCY_MS = parseInt(process.env.REDIS_DEGRADED_LATENCY_MS, 10) || 100;
const HORIZON_DEGRADED_LATENCY_MS = parseInt(process.env.HORIZON_DEGRADED_LATENCY_MS, 10) || 1_000;
const SOROBAN_DEGRADED_LATENCY_MS = parseInt(process.env.SOROBAN_DEGRADED_LATENCY_MS, 10) || 1_000;

const DISK_USAGE_DEGRADED_PERCENT = parseInt(process.env.DISK_USAGE_DEGRADED_PERCENT, 10) || 80;
const DISK_USAGE_UNHEALTHY_PERCENT = parseInt(process.env.DISK_USAGE_UNHEALTHY_PERCENT, 10) || 90;
const HEALTH_DISK_PATH = process.env.HEALTH_DISK_PATH || process.cwd();

const MEMORY_RSS_DEGRADED_MB = parseInt(process.env.MEMORY_RSS_DEGRADED_MB, 10) || 400;
const MEMORY_RSS_UNHEALTHY_MB = parseInt(process.env.MEMORY_RSS_UNHEALTHY_MB, 10) || 500;

const EVENT_LOOP_LAG_DEGRADED_MS = parseInt(process.env.EVENT_LOOP_LAG_DEGRADED_MS, 10) || 50;
const EVENT_LOOP_LAG_UNHEALTHY_MS = parseInt(process.env.EVENT_LOOP_LAG_UNHEALTHY_MS, 10) || 100;

// ─── Shared helpers ───────────────────────────────────────────────────────────

/**
 * Reject with a timeout error if `promise` doesn't settle within `ms`.
 * Leaves `promise` itself running — callers only care about the race outcome.
 *
 * @template T
 * @param {Promise<T>} promise
 * @param {number} ms
 * @param {string} label
 * @returns {Promise<T>}
 */
function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms} ms`));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/**
 * Classify a successful probe as 'healthy' or 'degraded' based on latency.
 *
 * @param {number} latencyMs
 * @param {number} degradedThresholdMs
 * @param {string} okMessage
 * @returns {{ status: 'healthy'|'degraded', latency: number, message: string }}
 */
function classifyLatency(latencyMs, degradedThresholdMs, okMessage) {
  if (latencyMs > degradedThresholdMs) {
    return {
      status: "degraded",
      latency: latencyMs,
      message: `${okMessage} (elevated latency: ${latencyMs} ms)`,
    };
  }
  return { status: "healthy", latency: latencyMs, message: okMessage };
}

/**
 * Issue a plain HTTP(S) GET to `url` and resolve with { ok, latencyMs, error? }.
 * Does not throw — failures are returned as { ok: false, error }.
 *
 * @param {string} url
 * @returns {Promise<{ ok: boolean, latencyMs: number, error?: string }>}
 */
function probeGet(url) {
  return new Promise((resolve) => {
    const start = Date.now();
    const mod = url.startsWith("https") ? https : http;

    const req = mod.get(url, { timeout: HEALTH_TIMEOUT_MS }, (res) => {
      res.resume();
      res.on("end", () => {
        resolve({ ok: res.statusCode < 500, latencyMs: Date.now() - start });
      });
    });

    req.on("timeout", () => {
      req.destroy();
      resolve({
        ok: false,
        latencyMs: Date.now() - start,
        error: `timed out after ${HEALTH_TIMEOUT_MS} ms`,
      });
    });

    req.on("error", (err) => {
      resolve({ ok: false, latencyMs: Date.now() - start, error: err.message });
    });
  });
}

/**
 * Issue a minimal JSON-RPC POST to the Soroban RPC URL to call getHealth.
 *
 * @param {string} url
 * @returns {Promise<{ ok: boolean, latencyMs: number, error?: string }>}
 */
function probeSorobanRpc(url) {
  return new Promise((resolve) => {
    const start = Date.now();
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getHealth",
      params: {},
    });
    const parsedUrl = new URL(url);
    const mod = parsedUrl.protocol === "https:" ? https : http;
    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (parsedUrl.protocol === "https:" ? 443 : 80),
      path: parsedUrl.pathname || "/",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
      timeout: HEALTH_TIMEOUT_MS,
    };

    const req = mod.request(options, (res) => {
      res.resume();
      res.on("end", () => {
        resolve({ ok: res.statusCode < 500, latencyMs: Date.now() - start });
      });
    });

    req.on("timeout", () => {
      req.destroy();
      resolve({
        ok: false,
        latencyMs: Date.now() - start,
        error: `timed out after ${HEALTH_TIMEOUT_MS} ms`,
      });
    });

    req.on("error", (err) => {
      resolve({ ok: false, latencyMs: Date.now() - start, error: err.message });
    });

    req.write(body);
    req.end();
  });
}

// ─── Individual dependency checks ────────────────────────────────────────────

/**
 * Ping PostgreSQL (via the app's Knex connection — SQLite in dev/test,
 * PostgreSQL in production) and measure round-trip latency.
 *
 * @returns {Promise<{ status: string, latency: number, message: string }>}
 */
async function checkPostgres() {
  const start = Date.now();
  try {
    await withTimeout(knex.raw("SELECT 1"), HEALTH_TIMEOUT_MS, "PostgreSQL");
    const latency = Date.now() - start;
    return classifyLatency(latency, POSTGRES_DEGRADED_LATENCY_MS, "PostgreSQL is reachable");
  } catch (err) {
    logger.warn({ err }, "health: PostgreSQL check failed");
    return { status: "unhealthy", latency: Date.now() - start, message: err.message };
  }
}

/**
 * PING Redis directly (bypassing the LRU fallback) and measure latency.
 * Reports 'healthy' when REDIS_URL is not configured — the app is designed
 * to run on the in-memory LRU cache alone, so an absent Redis is not a fault.
 *
 * @returns {Promise<{ status: string, latency: number, message: string }>}
 */
async function checkRedis() {
  const start = Date.now();
  try {
    const result = await withTimeout(cacheService.ping(), HEALTH_TIMEOUT_MS, "Redis");
    const latency = Date.now() - start;
    if (result === null) {
      return {
        status: "healthy",
        latency,
        message: "REDIS_URL not configured; using in-memory cache fallback",
      };
    }
    return classifyLatency(latency, REDIS_DEGRADED_LATENCY_MS, "Redis is reachable");
  } catch (err) {
    logger.warn({ err }, "health: Redis check failed");
    return { status: "unhealthy", latency: Date.now() - start, message: err.message };
  }
}

/**
 * Call the Horizon root endpoint and check response time.
 *
 * @returns {Promise<{ status: string, latency: number, message: string }>}
 */
async function checkHorizon() {
  const horizonUrl = process.env.HORIZON_URL || "https://horizon-testnet.stellar.org";
  const result = await probeGet(horizonUrl);
  if (!result.ok) {
    logger.warn({ error: result.error }, "health: Horizon unreachable");
    return {
      status: "unhealthy",
      latency: result.latencyMs,
      message: result.error || "Horizon returned a server error",
    };
  }
  return classifyLatency(result.latencyMs, HORIZON_DEGRADED_LATENCY_MS, "Horizon is reachable");
}

/**
 * Call the Soroban RPC getHealth method. Reports 'healthy' (skipped) when
 * SOROBAN_RPC_URL is not configured, matching checkRedis's opt-in behaviour.
 *
 * @returns {Promise<{ status: string, latency: number, message: string }>}
 */
async function checkSorobanRpc() {
  const sorobanRpcUrl = process.env.SOROBAN_RPC_URL || null;
  if (!sorobanRpcUrl) {
    return {
      status: "healthy",
      latency: 0,
      message: "SOROBAN_RPC_URL not configured; check skipped",
    };
  }

  const result = await probeSorobanRpc(sorobanRpcUrl);
  if (!result.ok) {
    logger.warn({ error: result.error }, "health: Soroban RPC unreachable");
    return {
      status: "unhealthy",
      latency: result.latencyMs,
      message: result.error || "Soroban RPC returned a server error",
    };
  }
  return classifyLatency(result.latencyMs, SOROBAN_DEGRADED_LATENCY_MS, "Soroban RPC is reachable");
}

/**
 * Check available disk space at HEALTH_DISK_PATH (default: process cwd).
 *
 * @returns {Promise<{ status: string, latency: number, message: string }>}
 */
async function checkDiskSpace() {
  const start = Date.now();
  try {
    const stats = await fsp.statfs(HEALTH_DISK_PATH);
    const latency = Date.now() - start;
    const totalBytes = stats.blocks * stats.bsize;
    const freeBytes = stats.bavail * stats.bsize;
    const usedPercent = totalBytes > 0 ? ((totalBytes - freeBytes) / totalBytes) * 100 : 0;
    const message = `Disk usage ${usedPercent.toFixed(1)}% at ${HEALTH_DISK_PATH}`;

    if (usedPercent >= DISK_USAGE_UNHEALTHY_PERCENT) {
      return { status: "unhealthy", latency, message };
    }
    if (usedPercent >= DISK_USAGE_DEGRADED_PERCENT) {
      return { status: "degraded", latency, message };
    }
    return { status: "healthy", latency, message };
  } catch (err) {
    logger.warn({ err }, "health: disk space check failed");
    return { status: "unhealthy", latency: Date.now() - start, message: err.message };
  }
}

/**
 * Check the process's resident set size (RSS) against configured thresholds.
 *
 * @returns {Promise<{ status: string, latency: number, message: string }>}
 */
async function checkMemoryUsage() {
  const start = Date.now();
  const rssMb = process.memoryUsage().rss / (1024 * 1024);
  const latency = Date.now() - start;
  const message = `Process RSS ${rssMb.toFixed(1)} MB`;

  if (rssMb >= MEMORY_RSS_UNHEALTHY_MB) {
    return { status: "unhealthy", latency, message };
  }
  if (rssMb >= MEMORY_RSS_DEGRADED_MB) {
    return { status: "degraded", latency, message };
  }
  return { status: "healthy", latency, message };
}

/**
 * Measure event loop lag on demand: how long it takes a setImmediate
 * callback to run after being scheduled. A busy event loop delays it.
 *
 * @returns {Promise<{ status: string, latency: number, message: string }>}
 */
function checkEventLoop() {
  return new Promise((resolve) => {
    const start = process.hrtime.bigint();
    setImmediate(() => {
      const lagMs = Number(process.hrtime.bigint() - start) / 1e6;
      const message = `Event loop lag ${lagMs.toFixed(1)} ms`;

      if (lagMs >= EVENT_LOOP_LAG_UNHEALTHY_MS) {
        resolve({ status: "unhealthy", latency: lagMs, message });
      } else if (lagMs >= EVENT_LOOP_LAG_DEGRADED_MS) {
        resolve({ status: "degraded", latency: lagMs, message });
      } else {
        resolve({ status: "healthy", latency: lagMs, message });
      }
    });
  });
}

// ─── Aggregation ──────────────────────────────────────────────────────────────

/**
 * Run every dependency probe concurrently.
 *
 * @returns {Promise<Record<string, { status: string, latency: number, message: string }>>}
 */
async function runAllChecks() {
  const [postgres, redis, horizon, sorobanRpc, diskSpace, memoryUsage, eventLoop] =
    await Promise.all([
      checkPostgres(),
      checkRedis(),
      checkHorizon(),
      checkSorobanRpc(),
      checkDiskSpace(),
      checkMemoryUsage(),
      checkEventLoop(),
    ]);

  return {
    postgres,
    redis,
    horizon,
    soroban_rpc: sorobanRpc,
    disk_space: diskSpace,
    memory_usage: memoryUsage,
    event_loop: eventLoop,
  };
}

/**
 * Check whether server initialisation has completed: migrations applied,
 * the scheduled-transaction executor running, and the event indexer running
 * (or intentionally disabled because no CONTRACT_ID is configured).
 *
 * @returns {Promise<{ started: boolean, checks: Record<string, boolean> }>}
 */
async function checkStartupComplete() {
  let migrationsComplete = false;
  try {
    const [, pending] = await withTimeout(
      knex.migrate.list(),
      HEALTH_TIMEOUT_MS,
      "Migration status check",
    );
    migrationsComplete = pending.length === 0;
  } catch (err) {
    logger.warn({ err }, "health: migration status check failed");
  }

  const checks = {
    migrations: migrationsComplete,
    executor: scheduledExecutor.isStarted(),
    indexer: eventIndexer.isRunning(),
  };

  return { started: Object.values(checks).every(Boolean), checks };
}

module.exports = {
  checkPostgres,
  checkRedis,
  checkHorizon,
  checkSorobanRpc,
  checkDiskSpace,
  checkMemoryUsage,
  checkEventLoop,
  runAllChecks,
  checkStartupComplete,
};

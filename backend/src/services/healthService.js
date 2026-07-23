/**
 * src/services/healthService.js
 * Probes downstream dependencies for the GET /health/ready readiness check.
 *
 * Horizon is probed by hitting its root endpoint (/). The call is considered
 * successful when the response arrives within HEALTH_TIMEOUT_MS (default 5 s).
 *
 * Soroban RPC is probed only when SOROBAN_RPC_URL is set in the environment.
 * The probe issues a minimal JSON-RPC request (getHealth) and expects a 200
 * response. When the variable is absent the dependency is reported as "skipped"
 * and never causes a 503.
 */

"use strict";

const https = require("https");
const http = require("http");
const logger = require("../utils/logger");

const HEALTH_TIMEOUT_MS = parseInt(process.env.HEALTH_TIMEOUT_MS, 10) || 5_000;

/**
 * Issue a plain HTTP(S) GET to `url` and resolve with { latencyMs, ok }.
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
      // Drain the body so the socket is released.
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
      resolve({
        ok: false,
        latencyMs: Date.now() - start,
        error: err.message,
      });
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
      resolve({
        ok: false,
        latencyMs: Date.now() - start,
        error: err.message,
      });
    });

    req.write(body);
    req.end();
  });
}

/**
 * Run all dependency probes in parallel.
 *
 * @returns {Promise<{
 *   healthy: boolean,
 *   dependencies: Record<string, { status: string, latencyMs?: number, error?: string }>
 * }>}
 */
async function checkDependencies() {
  const horizonUrl =
    process.env.HORIZON_URL || "https://horizon-testnet.stellar.org";
  const sorobanRpcUrl = process.env.SOROBAN_RPC_URL || null;

  // Run probes concurrently.
  const [horizonResult, sorobanResult] = await Promise.all([
    probeGet(horizonUrl).catch((err) => ({
      ok: false,
      latencyMs: 0,
      error: String(err),
    })),
    sorobanRpcUrl
      ? probeSorobanRpc(sorobanRpcUrl).catch((err) => ({
          ok: false,
          latencyMs: 0,
          error: String(err),
        }))
      : Promise.resolve(null),
  ]);

  const dependencies = {};

  // Horizon — always probed.
  if (horizonResult.ok) {
    dependencies.horizon = {
      status: "ok",
      latencyMs: horizonResult.latencyMs,
    };
  } else {
    logger.warn({ error: horizonResult.error }, "health: Horizon unreachable");
    dependencies.horizon = {
      status: "error",
      latencyMs: horizonResult.latencyMs,
      error: horizonResult.error,
    };
  }

  // Soroban RPC — probed only when SOROBAN_RPC_URL is configured.
  if (sorobanRpcUrl) {
    if (sorobanResult.ok) {
      dependencies.soroban_rpc = {
        status: "ok",
        latencyMs: sorobanResult.latencyMs,
      };
    } else {
      logger.warn(
        { error: sorobanResult.error },
        "health: Soroban RPC unreachable",
      );
      dependencies.soroban_rpc = {
        status: "error",
        latencyMs: sorobanResult.latencyMs,
        error: sorobanResult.error,
      };
    }
  }

  const healthy = Object.values(dependencies).every((d) => d.status === "ok");

  return { healthy, dependencies };
}

module.exports = { checkDependencies };

/**
 * src/services/featureFlagsService.js
 * Feature flag service — loads flags from the JSON config at startup and
 * provides runtime evaluation with per-environment toggles, percentage-based
 * rollouts, and an admin toggle API.
 *
 * No external service dependency (LaunchDarkly, etc.) — all state lives in
 * memory, seeded from featureFlags.json. Toggled state survives for the
 * lifetime of the process; a server restart reloads the config from disk.
 *
 * Flag evaluation rule (matches frontend FeatureFlags.tsx):
 *   enabled = environmentEnabled && rolloutPercent > Math.random() * 100
 *
 * For deterministic per-user evaluation the frontend hashes the user's public
 * key — the backend uses a simple random check which is appropriate for
 * server-side gating (e.g. blocking an API route entirely).
 */

"use strict";

const path = require("path");
const fs   = require("fs");

// ─── Config ───────────────────────────────────────────────────────────────────

const CONFIG_PATH = path.resolve(__dirname, "../config/featureFlags.json");

/**
 * @typedef {Object} FlagDefinition
 * @property {string}  key
 * @property {string}  description
 * @property {{ development: boolean, staging: boolean, production: boolean }} environments
 * @property {number}  rolloutPercent   0–100
 * @property {string}  owner
 * @property {string}  createdAt        ISO 8601
 */

/** @type {Map<string, FlagDefinition>} */
const _flags = new Map();

/** Track runtime overrides applied via the toggle API (key → boolean | null). */
const _overrides = new Map();

// ─── Bootstrap ────────────────────────────────────────────────────────────────

/**
 * Load flags from featureFlags.json into the in-memory map.
 * Called once at module load; can also be called in tests to reset state.
 *
 * @returns {void}
 */
function loadFlags() {
  _flags.clear();
  _overrides.clear();

  let raw;
  try {
    raw = fs.readFileSync(CONFIG_PATH, "utf8");
  } catch (err) {
    // Non-fatal in test environments where the config path may differ.
    if (process.env.NODE_ENV !== "test") {
      console.error("[FeatureFlags] Could not read featureFlags.json:", err.message);
    }
    return;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.error("[FeatureFlags] Invalid JSON in featureFlags.json:", err.message);
    return;
  }

  const flags = Array.isArray(parsed.flags) ? parsed.flags : [];
  for (const flag of flags) {
    if (typeof flag.key !== "string" || !flag.key) continue;
    _flags.set(flag.key, flag);
  }
}

// Load on module initialisation.
loadFlags();

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Resolve the current NODE_ENV to one of the three canonical environment names.
 *
 * @returns {"development"|"staging"|"production"}
 */
function currentEnv() {
  const env = (process.env.NODE_ENV || "development").toLowerCase();
  if (env === "production") return "production";
  if (env === "staging")    return "staging";
  return "development";
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Return all flag definitions as a plain array, including the current
 * evaluated `enabled` state for the running environment.
 *
 * @returns {Array<FlagDefinition & { enabled: boolean }>}
 */
function getAllFlags() {
  const env = currentEnv();
  return Array.from(_flags.values()).map((flag) => ({
    ...flag,
    enabled: evaluateFlag(flag.key, env),
  }));
}

/**
 * Evaluate a single flag for the given (or current) environment.
 *
 * Evaluation order:
 *  1. Runtime override set via `toggleFlag()` — takes absolute precedence.
 *  2. Environment toggle from config (`environments[env]`).
 *  3. Rollout percentage — `Math.random() * 100 < rolloutPercent`.
 *
 * @param {string} key
 * @param {string} [env]  Defaults to currentEnv().
 * @returns {boolean}
 */
function evaluateFlag(key, env) {
  const flag = _flags.get(key);
  if (!flag) return false;

  // Runtime admin override wins.
  if (_overrides.has(key)) return _overrides.get(key);

  const resolvedEnv = env || currentEnv();
  const envEnabled = flag.environments?.[resolvedEnv] ?? false;
  if (!envEnabled) return false;

  const pct = typeof flag.rolloutPercent === "number" ? flag.rolloutPercent : 0;
  if (pct <= 0)   return false;
  if (pct >= 100) return true;

  return Math.random() * 100 < pct;
}

/**
 * Return a simple `{ key: boolean }` map for all flags, suitable for sending
 * to the frontend. Merges evaluated state with any runtime overrides.
 *
 * @returns {Record<string, boolean>}
 */
function getFlagsForClient() {
  const env = currentEnv();
  const result = {};
  for (const key of _flags.keys()) {
    result[key] = evaluateFlag(key, env);
  }
  return result;
}

/**
 * Toggle a flag's runtime override.
 *
 * - Passing `true` / `false` forces the flag on/off regardless of config.
 * - Passing `null` removes the override and falls back to config evaluation.
 *
 * Returns the updated flag definition with its new evaluated state, or `null`
 * if the key does not exist.
 *
 * @param {string}           key
 * @param {boolean|null}     value
 * @returns {(FlagDefinition & { enabled: boolean })|null}
 */
function toggleFlag(key, value) {
  if (!_flags.has(key)) return null;

  if (value === null || value === undefined) {
    _overrides.delete(key);
  } else {
    _overrides.set(key, !!value);
  }

  return { ..._flags.get(key), enabled: evaluateFlag(key) };
}

/**
 * Return a single flag definition with evaluated state, or `null` if not found.
 *
 * @param {string} key
 * @returns {(FlagDefinition & { enabled: boolean })|null}
 */
function getFlag(key) {
  if (!_flags.has(key)) return null;
  return { ..._flags.get(key), enabled: evaluateFlag(key) };
}

module.exports = {
  loadFlags,
  getAllFlags,
  evaluateFlag,
  getFlagsForClient,
  toggleFlag,
  getFlag,
};

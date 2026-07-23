/**
 * src/config/validateEnv.js
 * Fail-fast validation for required backend environment variables.
 */

"use strict";

const VALID_NETWORKS = ["testnet", "mainnet"];

/**
 * Rules for a well-formed ALLOWED_ORIGINS entry.
 *
 * A valid origin is scheme://host[:port] with:
 *  - scheme: http or https only
 *  - host: a hostname or IP address (no wildcards, no path, no trailing slash)
 *  - port: optional, digits only
 *
 * Anything else — trailing slash, wildcard (*), path component, bare domain
 * without a scheme — is flagged as malformed.
 */
const VALID_ORIGIN_RE = /^https?:\/\/[^/*\s]+(:\d+)?$/;

/**
 * Parse and validate the ALLOWED_ORIGINS env var.
 *
 * Returns an object with:
 *  - origins:  string[] of trimmed, valid origin values (safe to use at runtime)
 *  - warnings: string[] of human-readable messages for every malformed entry
 *
 * @param {string|undefined} raw  Raw value of process.env.ALLOWED_ORIGINS
 * @returns {{ origins: string[], warnings: string[] }}
 */
function parseAllowedOrigins(raw) {
  const fallback = "http://localhost:3000";
  const origins = [];
  const warnings = [];

  if (!raw || !raw.trim()) {
    return { origins: [fallback], warnings: [] };
  }

  for (const entry of raw.split(",")) {
    const trimmed = entry.trim();

    if (!trimmed) {
      // skip empty segments from e.g. "http://a.com,,http://b.com"
      continue;
    }

    if (!VALID_ORIGIN_RE.test(trimmed)) {
      warnings.push(
        `ALLOWED_ORIGINS entry "${trimmed}" is malformed — ` +
          `expected scheme://host[:port] with no trailing slash, path, or wildcard`,
      );
      // Still include it so startup warnings don't silently change CORS
      // behaviour; a human needs to decide whether to fix or remove it.
      origins.push(trimmed);
    } else {
      origins.push(trimmed);
    }
  }

  return { origins, warnings };
}

function collectErrors(env) {
  const errors = [];

  const stellarNetwork = env.STELLAR_NETWORK?.trim();
  if (!stellarNetwork) {
    errors.push('STELLAR_NETWORK is required (e.g. "testnet" or "mainnet")');
  } else if (!VALID_NETWORKS.includes(stellarNetwork)) {
    errors.push(
      `STELLAR_NETWORK must be "testnet" or "mainnet", got "${stellarNetwork}"`,
    );
  }

  const horizonUrl = env.HORIZON_URL?.trim();
  if (!horizonUrl) {
    errors.push(
      'HORIZON_URL is required (e.g. "https://horizon-testnet.stellar.org")',
    );
  } else {
    try {
      new URL(horizonUrl);
    } catch {
      errors.push(`HORIZON_URL must be a valid URL, got "${horizonUrl}"`);
    }
  }

  // ALLOWED_ORIGINS is optional (defaults to localhost:3000) but every entry
  // that is present must be a well-formed origin.
  const { warnings } = parseAllowedOrigins(env.ALLOWED_ORIGINS);
  for (const w of warnings) {
    // Malformed origins are surfaced as errors at startup — an operator must
    // fix the value before the server is trusted to make correct CORS decisions.
    errors.push(w);
  }

  // OTEL_EXPORTER_OTLP_ENDPOINT is optional but if set must be a valid URL.
  if (env.OTEL_EXPORTER_OTLP_ENDPOINT) {
    const otelEndpoint = String(env.OTEL_EXPORTER_OTLP_ENDPOINT).trim();
    if (otelEndpoint.length > 0) {
      try {
        new URL(otelEndpoint);
      } catch {
        errors.push(
          `OTEL_EXPORTER_OTLP_ENDPOINT must be a valid URL, got "${otelEndpoint}"`,
        );
      }
    }
  }

  // REDIS_URL is optional but if set must be a valid redis:// URL.
  if (env.REDIS_URL) {
    const redisUrl = String(env.REDIS_URL).trim();
    if (redisUrl.length > 0 && !redisUrl.startsWith("redis://") && !redisUrl.startsWith("rediss://")) {
      errors.push(
        `REDIS_URL must start with redis:// or rediss://, got "${redisUrl}"`,
      );
    }
  }

  // REDIS_CACHE_TTL_DEFAULT is optional; default is 60.
  if (env.REDIS_CACHE_TTL_DEFAULT) {
    const ttl = parseInt(env.REDIS_CACHE_TTL_DEFAULT, 10);
    if (isNaN(ttl) || ttl < 1) {
      errors.push(
        `REDIS_CACHE_TTL_DEFAULT must be a positive integer, got "${env.REDIS_CACHE_TTL_DEFAULT}"`,
      );
    }
  }
  // ANCHORS_CONFIG is optional but if set must be valid JSON.
  if (env.ANCHORS_CONFIG) {
    try {
      JSON.parse(env.ANCHORS_CONFIG);
    } catch (err) {
      errors.push(`ANCHORS_CONFIG must be valid JSON: ${err.message}`);
    }
  }
  return errors;
}

/**
 * Validate required environment variables.
 * Logs actionable errors and exits the process when validation fails.
 *
 * @param {NodeJS.ProcessEnv} [env=process.env]
 */
function validateEnv(env = process.env) {
  const errors = collectErrors(env);

  if (errors.length === 0) {
    return;
  }

  console.error("\nEnvironment validation failed:\n");
  for (const message of errors) {
    console.error(`  - ${message}`);
  }
  console.error(
    "\nCopy backend/.env.example to backend/.env and set the required values.\n",
  );
  process.exit(1);
}

module.exports = { validateEnv, collectErrors, parseAllowedOrigins };

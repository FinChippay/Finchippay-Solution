/**
 * src/config/validateEnv.js
 * Fail-fast validation for required backend environment variables.
 */

"use strict";

const logger = require("../utils/logger");

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
  if (!env.JWT_SECRET && env.NODE_ENV === "production") {
    throw new Error("FATAL: JWT_SECRET must be set in production.");
  }
  if (env.JWT_SECRET === "finchippay_secret_key") {
    throw new Error("FATAL: JWT_SECRET is set to the insecure default value.");
  }

  const errors = [];

  // Database provider validation
  const dbProvider = (env.DB_PROVIDER || "sqlite").toLowerCase();
  if (!["sqlite", "postgres"].includes(dbProvider)) {
    errors.push(`DB_PROVIDER must be "sqlite" or "postgres", got "${dbProvider}"`);
  }

  if (dbProvider === "postgres") {
    const dbUrl = env.DATABASE_URL || env.DATABASE_URL_PROD;
    if (!dbUrl || !dbUrl.trim()) {
      errors.push("DATABASE_URL is required when DB_PROVIDER=postgres");
    } else {
      try {
        new URL(dbUrl);
      } catch {
        errors.push(`DATABASE_URL must be a valid URL, got "${dbUrl}"`);
      }
    }
  }

  const stellarNetwork = env.STELLAR_NETWORK?.trim();
  if (!stellarNetwork) {
    errors.push('STELLAR_NETWORK is required (e.g. "testnet" or "mainnet")');
  } else if (!VALID_NETWORKS.includes(stellarNetwork)) {
    errors.push(`STELLAR_NETWORK must be "testnet" or "mainnet", got "${stellarNetwork}"`);
  }

  const horizonUrl = env.HORIZON_URL?.trim();
  if (!horizonUrl) {
    errors.push('HORIZON_URL is required (e.g. "https://horizon-testnet.stellar.org")');
  } else {
    try {
      new URL(horizonUrl);
    } catch {
      errors.push(`HORIZON_URL must be a valid URL, got "${horizonUrl}"`);
    }
  }

  if (String(env.NODE_ENV || "").toLowerCase() === "production") {
    const rateLimitHashSalt = String(env.RATE_LIMIT_IP_HASH_SALT || "").trim();

    if (!rateLimitHashSalt) {
      errors.push(
        "RATE_LIMIT_IP_HASH_SALT is required in production for stable, privacy-preserving rate-limit analytics",
      );
    } else if (rateLimitHashSalt.length < 32) {
      errors.push("RATE_LIMIT_IP_HASH_SALT must contain at least 32 characters in production");
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

  // SOROBAN_RPC_URL is optional but if set must be a valid URL.
  if (env.SOROBAN_RPC_URL) {
    const rpcUrl = String(env.SOROBAN_RPC_URL).trim();
    if (rpcUrl.length > 0) {
      try {
        new URL(rpcUrl);
      } catch {
        errors.push(`SOROBAN_RPC_URL must be a valid URL, got "${rpcUrl}"`);
      }
    }
  }

  // OTEL_EXPORTER_OTLP_ENDPOINT is optional but if set must be a valid URL.
  if (env.OTEL_EXPORTER_OTLP_ENDPOINT) {
    const otelEndpoint = String(env.OTEL_EXPORTER_OTLP_ENDPOINT).trim();
    if (otelEndpoint.length > 0) {
      try {
        new URL(otelEndpoint);
      } catch {
        errors.push(`OTEL_EXPORTER_OTLP_ENDPOINT must be a valid URL, got "${otelEndpoint}"`);
      }
    }
  }

  // REDIS_URL is optional but if set must be a valid redis:// URL.
  if (env.REDIS_URL) {
    const redisUrl = String(env.REDIS_URL).trim();
    if (
      redisUrl.length > 0 &&
      !redisUrl.startsWith("redis://") &&
      !redisUrl.startsWith("rediss://")
    ) {
      errors.push(`REDIS_URL must start with redis:// or rediss://, got "${redisUrl}"`);
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
  // DATA_RETENTION_DAYS is optional; default is 365.
  if (env.DATA_RETENTION_DAYS) {
    const days = parseInt(env.DATA_RETENTION_DAYS, 10);
    if (isNaN(days) || days < 1) {
      errors.push(
        `DATA_RETENTION_DAYS must be a positive integer, got "${env.DATA_RETENTION_DAYS}"`,
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

  // WEBHOOK_ENCRYPTION_KEY is required in production for encrypting webhook secrets at rest.
  if (env.NODE_ENV === "production" && !env.WEBHOOK_ENCRYPTION_KEY?.trim()) {
    errors.push(
      "WEBHOOK_ENCRYPTION_KEY is required in production — generate one with: openssl rand -hex 32",
    );
  }

  // BODY_LIMIT_JSON is optional (default: "1mb").
  if (env.BODY_LIMIT_JSON) {
    const val = String(env.BODY_LIMIT_JSON).trim();
    const match = val.match(/^(\d+)(kb|mb|gb)$/i);
    if (!match) {
      errors.push(
        `BODY_LIMIT_JSON must be a valid size string (e.g. "1mb", "512kb"), got "${val}"`,
      );
    }
  }

  // BODY_LIMIT_URLENCODED is optional (default: "100kb").
  if (env.BODY_LIMIT_URLENCODED) {
    const val = String(env.BODY_LIMIT_URLENCODED).trim();
    const match = val.match(/^(\d+)(kb|mb|gb)$/i);
    if (!match) {
      errors.push(
        `BODY_LIMIT_URLENCODED must be a valid size string (e.g. "100kb", "1mb"), got "${val}"`,
      );
    }
  }

  // CSV_UPLOAD_MAX_SIZE is optional (default: 10485760 for 10MB).
  if (env.CSV_UPLOAD_MAX_SIZE) {
    const val = parseInt(env.CSV_UPLOAD_MAX_SIZE, 10);
    if (isNaN(val) || val < 1) {
      errors.push(
        `CSV_UPLOAD_MAX_SIZE must be a positive integer (bytes), got "${env.CSV_UPLOAD_MAX_SIZE}"`,
      );
    }
  }

  // VAPID keys are optional — without them pushService degrades to a no-op and
  // the app never offers notifications. In production they are required for
  // web push notifications to function; in dev/test they gracefully degrade.
  // They are validated as a set, because a half-configured pair is a silent
  // misconfiguration: the client would be handed a public key for pushes the
  // server cannot actually sign.
  const vapidPublic = String(env.VAPID_PUBLIC_KEY || "").trim();
  const vapidPrivate = String(env.VAPID_PRIVATE_KEY || "").trim();

  if (vapidPublic && !vapidPrivate) {
    errors.push(
      "VAPID_PRIVATE_KEY is required when VAPID_PUBLIC_KEY is set (push notifications need both)",
    );
  }

  if (vapidPrivate && !vapidPublic) {
    errors.push(
      "VAPID_PUBLIC_KEY is required when VAPID_PRIVATE_KEY is set (push notifications need both)",
    );
  }

  // In production, at least warn if VAPID keys are missing (optional, not a startup blocker)
  // Push notifications are a best-effort feature that degrades gracefully.
  if (String(env.NODE_ENV || "").toLowerCase() === "production") {
    if (!vapidPublic && !vapidPrivate) {
      // Push is an optional feature — warn but don't block startup
      // The pushService already degrades to a no-op when keys are missing.
    }
  }

  // VAPID_SUBJECT identifies the sender to the push service; RFC 8292 requires
  // a mailto: or https: URI.
  if (env.VAPID_SUBJECT) {
    const subject = String(env.VAPID_SUBJECT).trim();
    if (subject.length > 0 && !subject.startsWith("mailto:") && !subject.startsWith("https://")) {
      errors.push(`VAPID_SUBJECT must be a mailto: or https:// URL, got "${subject}"`);
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

  logger.error(
    { errors, count: errors.length },
    "Environment validation failed — copy backend/.env.example to backend/.env and set the required values",
  );
  logger.fatal(
    { errors },
    "Environment validation failed. Copy backend/.env.example to backend/.env and set the required values.",
  );
  process.exit(1);
}

module.exports = { validateEnv, collectErrors, parseAllowedOrigins };

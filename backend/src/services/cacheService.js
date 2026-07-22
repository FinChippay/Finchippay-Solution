/**
 * src/services/cacheService.js
 * Redis-backed caching layer with in-memory LRU fallback for Horizon queries.
 *
 * Architecture:
 *   1. Redis (ioredis) — shared across all backend instances when REDIS_URL is set.
 *   2. LRU (Map-based) — per-process fallback, always active.
 *   3. Graceful degradation — if Redis is unavailable, log a warning and use LRU only.
 *
 * Cache keys use namespaced prefixes:
 *   - account:<publicKey>           → account balances (30 s TTL)
 *   - payments:<publicKey>:<limit>:<cursor?> → payment history (60 s TTL)
 *   - analytics:summary:<publicKey>  → analytics summary (5 min TTL)
 *   - analytics:top-recipients:<pk>  → top recipients (5 min TTL)
 *   - analytics:activity:<publicKey> → activity by day (5 min TTL)
 *
 * Usage:
 *   const cache = require("./cacheService");
 *   const data = await cache.get("account:GABC...");
 *   await cache.set("account:GABC...", accountData, 30);
 *   await cache.del("account:GABC...");
 *   await cache.delPattern("analytics:*");
 */

"use strict";

const logger = require("../utils/logger");

// ─── Configuration ───────────────────────────────────────────────────────────

const REDIS_URL = process.env.REDIS_URL || null;
const DEFAULT_TTL_SECONDS = parseInt(process.env.REDIS_CACHE_TTL_DEFAULT || "60", 10);
const LRU_MAX_ENTRIES = 512;

// ─── Redis client (lazy initialised) ─────────────────────────────────────────

/** @type {import("ioredis").Redis|null} */
let redis = null;
let redisStatus = REDIS_URL ? "connecting" : "disabled";
let redisReady = false;

/**
 * Initialise the Redis connection if REDIS_URL is set.
 * Called once at startup by server.js.
 *
 * @returns {Promise<void>}
 */
async function initRedis() {
  if (!REDIS_URL) {
    redisStatus = "disabled";
    logger.info("REDIS_URL not set — cacheService using LRU-only mode");
    return;
  }

  try {
    // Dynamic import so ioredis is not required at module parse time
    // when Redis is not configured.
    const { Redis } = require("ioredis");

    redis = new Redis(REDIS_URL, {
      maxRetriesPerRequest: 2,
      retryStrategy(times) {
        if (times > 10) {
          logger.error("Redis retry limit reached — switching to degraded mode");
          redisStatus = "degraded";
          redisReady = false;
          return null; // stop retrying
        }
        return Math.min(times * 200, 3000);
      },
      lazyConnect: true,
      enableOfflineQueue: false,
    });

    redis.on("connect", () => {
      redisStatus = "connected";
      redisReady = true;
      logger.info("Redis connected successfully");
    });

    redis.on("error", (err) => {
      logger.error({ err }, "Redis connection error");
      redisReady = false;
      if (redisStatus !== "degraded") {
        redisStatus = "degraded";
      }
    });

    redis.on("close", () => {
      redisReady = false;
      if (redisStatus === "connected") {
        redisStatus = "degraded";
        logger.warn("Redis connection closed — falling back to LRU-only");
      }
    });

    redis.on("reconnecting", () => {
      logger.info("Redis reconnecting…");
    });

    await redis.connect();
  } catch (err) {
    logger.error({ err }, "Failed to initialise Redis — using LRU-only mode");
    redisStatus = "degraded";
    redisReady = false;
    redis = null;
  }
}

/**
 * Gracefully shut down the Redis connection.
 */
async function closeRedis() {
  if (redis) {
    try {
      await redis.quit();
      logger.info("Redis connection closed gracefully");
    } catch (err) {
      logger.error({ err }, "Error closing Redis connection");
      redis.disconnect();
    }
    redis = null;
  }
}

/**
 * Return the current Redis connection status.
 * @returns {"connected"|"degraded"|"disabled"}
 */
function getRedisStatus() {
  return redisStatus;
}

// ─── In-memory LRU fallback ──────────────────────────────────────────────────

/** @type {Map<string, { value: string, expiresAt: number }>} */
const lruCache = new Map();

function lruGet(key) {
  const entry = lruCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    lruCache.delete(key);
    return null;
  }
  // LRU: re-insert to move to end
  lruCache.delete(key);
  lruCache.set(key, entry);
  return entry.value;
}

function lruSet(key, value, ttlSeconds) {
  if (lruCache.size >= LRU_MAX_ENTRIES) {
    lruCache.delete(lruCache.keys().next().value);
  }
  lruCache.set(key, {
    value, // already JSON-serialized by the public set() method
    expiresAt: Date.now() + ttlSeconds * 1000,
  });
}

function lruDel(key) {
  lruCache.delete(key);
}

function lruDelPattern(pattern) {
  let count = 0;
  const regex = patternToRegex(pattern);
  for (const key of lruCache.keys()) {
    if (regex.test(key)) {
      lruCache.delete(key);
      count++;
    }
  }
  return count;
}

// ─── Pattern-to-regex helper ─────────────────────────────────────────────────

function patternToRegex(pattern) {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Retrieve a cached value by key.
 * Checks Redis first; falls back to LRU on Redis miss or when Redis is unavailable.
 *
 * @param {string} key
 * @returns {Promise<object|null>}
 */
async function get(key) {
  // 1. Try Redis
  if (redis && redisReady) {
    try {
      const raw = await redis.get(key);
      if (raw) {
        // Extend TTL on read (refresh)
        const ttl = await redis.ttl(key);
        if (ttl > 0 && ttl < 10) {
          await redis.expire(key, DEFAULT_TTL_SECONDS);
        }
        return JSON.parse(raw);
      }
    } catch (err) {
      logger.warn({ err, key }, "Redis get failed — falling back to LRU");
    }
  }

  // 2. Fall back to LRU
  const lruVal = lruGet(key);
  if (lruVal) {
    try {
      return JSON.parse(lruVal);
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * Store a value in the cache.
 * Writes to both Redis and LRU.
 *
 * @param {string} key
 * @param {object} value
 * @param {number} [ttlSeconds] - TTL in seconds (default: REDIS_CACHE_TTL_DEFAULT)
 * @returns {Promise<void>}
 */
async function set(key, value, ttlSeconds = DEFAULT_TTL_SECONDS) {
  const serialized = JSON.stringify(value);

  // 1. Write to Redis
  if (redis && redisReady) {
    try {
      await redis.set(key, serialized, "EX", ttlSeconds);
    } catch (err) {
      logger.warn({ err, key }, "Redis set failed — value stored in LRU only");
    }
  }

  // 2. Always write to LRU
  lruSet(key, serialized, ttlSeconds);
}

/**
 * Delete a single cache entry.
 *
 * @param {string} key
 * @returns {Promise<void>}
 */
async function del(key) {
  if (redis && redisReady) {
    try {
      await redis.del(key);
    } catch (err) {
      logger.warn({ err, key }, "Redis del failed");
    }
  }
  lruDel(key);
}

/**
 * Delete all cache entries matching a glob-like pattern.
 * Supports `*` wildcard (e.g. "analytics:*").
 *
 * Uses Redis SCAN + DEL for efficient server-side matching;
 * falls back to LRU iteration for the local store.
 *
 * @param {string} pattern - e.g. "analytics:*"
 * @returns {Promise<number>} Number of keys deleted
 */
async function delPattern(pattern) {
  let count = 0;

  // 1. Redis: SCAN + pipeline DEL
  if (redis && redisReady) {
    try {
      let cursor = "0";
      do {
        const [nextCursor, keys] = await redis.scan(
          cursor,
          "MATCH",
          pattern,
          "COUNT",
          100,
        );
        cursor = nextCursor;
        if (keys && keys.length > 0) {
          await redis.del(...keys);
          count += keys.length;
        }
      } while (cursor !== "0");
    } catch (err) {
      logger.warn({ err, pattern }, "Redis delPattern failed");
    }
  }

  // 2. LRU cleanup
  count += lruDelPattern(pattern);

  if (count > 0) {
    logger.info({ pattern, count }, "Cache entries invalidated");
  }
  return count;
}

/**
 * Clear the entire LRU cache (useful in tests).
 * Does NOT flush Redis.
 */
function clearLRU() {
  lruCache.clear();
}

module.exports = {
  initRedis,
  closeRedis,
  getRedisStatus,
  get,
  set,
  del,
  delPattern,
  clearLRU,
};

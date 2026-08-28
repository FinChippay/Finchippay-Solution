/**
 * src/services/tokenService.js
 * Refresh token management, rotation, revocation, and session management service.
 * Supports Knex DB persistence with SHA-256 token hashing and in-memory fallback.
 */
"use strict";

const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { JWT_SECRET } = require("../middleware/auth");
let knex;
try {
  knex = require("../db/connection");
} catch (e) {
  knex = null;
}

// In-memory fallback store: tokenHash -> { id, publicKey, tokenHash, deviceInfo, ipAddress, expiresAt, revoked, createdAt, lastUsedAt }
const memoryStore = new Map();
let nextMemoryId = 1;

/**
 * Hash raw refresh token with SHA-256.
 */
function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/**
 * Duration units (jsonwebtoken-style shorthand) in seconds.
 */
const DURATION_UNITS = { s: 1, m: 60, h: 3600, d: 86400, w: 604800 };

/**
 * Parse a jsonwebtoken-style duration ("15m", "1h", "7d", "900") into seconds.
 * Falls back to `fallback` for missing or invalid values.
 */
function parseDurationToSeconds(value, fallback) {
  const str = String(value == null ? "" : value)
    .trim()
    .toLowerCase();
  if (/^\d+$/.test(str)) return parseInt(str, 10);
  const match = /^(\d+(?:\.\d+)?)\s*([smhdw])$/.exec(str);
  if (match) return Math.round(parseFloat(match[1]) * DURATION_UNITS[match[2]]);
  return fallback;
}

/**
 * Access-token TTL in seconds. Short by default (10 minutes) and configurable
 * via ACCESS_TOKEN_TTL (e.g. "5m", "900").
 */
function getAccessTokenTTLSeconds() {
  return parseDurationToSeconds(process.env.ACCESS_TOKEN_TTL, 10 * 60);
}

/**
 * Refresh-token TTL in seconds. Defaults to 7 days, configurable via
 * REFRESH_TOKEN_TTL (e.g. "14d").
 */
function getRefreshTokenTTLSeconds() {
  return parseDurationToSeconds(process.env.REFRESH_TOKEN_TTL, 7 * 24 * 60 * 60);
}

/**
 * Helper to check if Knex refresh_tokens table exists & ready.
 */
async function isDbAvailable() {
  if (!knex || typeof knex !== "function") return false;
  try {
    const exists = await knex.schema.hasTable("refresh_tokens");
    return Boolean(exists);
  } catch (e) {
    return false;
  }
}

/**
 * Issue a new access token (short-lived, configurable) and refresh token
 * (default 7 days). Every issued refresh token belongs to a token family:
 * rotated successors inherit `familyId`, which lets reuse detection revoke the
 * whole family at once.
 *
 * @param {string} publicKey - User's Stellar public key
 * @param {string} [deviceInfo] - Optional client device user-agent
 * @param {string} [ipAddress] - Optional client IP address
 * @param {string} [familyId] - Token family to join (defaults to a fresh UUID)
 * @returns {Promise<{ accessToken: string, refreshToken: string, expiresIn: number }>}
 */
async function issueTokens(publicKey, deviceInfo = null, ipAddress = null, familyId = null) {
  const accessTokenTtlSeconds = getAccessTokenTTLSeconds();
  const refreshTokenTtlSeconds = getRefreshTokenTTLSeconds();
  const accessToken = jwt.sign({ publicKey, jti: crypto.randomUUID() }, JWT_SECRET, {
    expiresIn: accessTokenTtlSeconds,
  });
  const refreshToken = crypto.randomBytes(40).toString("hex");
  const tokenHash = hashToken(refreshToken);
  const now = new Date();
  const expiresAt = new Date(Date.now() + refreshTokenTtlSeconds * 1000);
  const tokenFamilyId = familyId || crypto.randomUUID();

  if (await isDbAvailable()) {
    await knex("refresh_tokens").insert({
      public_key: publicKey,
      token_hash: tokenHash,
      family_id: tokenFamilyId,
      device_info: deviceInfo ? String(deviceInfo) : null,
      ip_address: ipAddress ? String(ipAddress) : null,
      expires_at: expiresAt,
      revoked: false,
      revoked_at: null,
      revoked_by: null,
      created_at: now,
      last_used_at: null,
    });
  } else {
    const id = nextMemoryId++;
    memoryStore.set(tokenHash, {
      id,
      publicKey,
      tokenHash,
      familyId: tokenFamilyId,
      deviceInfo: deviceInfo ? String(deviceInfo) : null,
      ipAddress: ipAddress ? String(ipAddress) : null,
      expiresAt: expiresAt.getTime(),
      revoked: false,
      revokedAt: null,
      revokedBy: null,
      createdAt: now,
      lastUsedAt: null,
    });
  }

  return { accessToken, refreshToken, expiresIn: accessTokenTtlSeconds };
}

/**
 * Rotate a refresh token.
 * Replay detection: If a revoked token is used, revokes ALL active tokens for that user.
 *
 * @param {string} oldToken - The refresh token to rotate
 * @param {string} [deviceInfo]
 * @param {string} [ipAddress]
 * @returns {Promise<{ accessToken: string, refreshToken: string, expiresIn: number } | null>}
 */
async function rotateRefreshToken(oldToken, deviceInfo = null, ipAddress = null) {
  if (!oldToken) return null;
  const oldHash = hashToken(oldToken);

  if (await isDbAvailable()) {
    const record = await knex("refresh_tokens").where("token_hash", oldHash).first();
    if (!record) return null;

    // Replay attack detection: if token is already revoked, revoke ALL user tokens
    if (record.revoked) {
      const now = new Date();
      await knex("refresh_tokens")
        .where("public_key", record.public_key)
        .update({ revoked: true, revoked_at: now, revoked_by: "reuse" });
      return null;
    }

    // Check expiration
    if (new Date(record.expires_at).getTime() < Date.now()) {
      return null;
    }

    // Mark old token as revoked and updated
    const now = new Date();
    await knex("refresh_tokens")
      .where("id", record.id)
      .update({ revoked: true, revoked_at: now, revoked_by: "rotation", last_used_at: now });

    // Issue new pair in the same token family
    return await issueTokens(
      record.public_key,
      deviceInfo || record.device_info,
      ipAddress || record.ip_address,
      record.family_id,
    );
  } else {
    const record = memoryStore.get(oldHash);
    if (!record) return null;

    if (record.revoked) {
      // Replay attack: revoke all tokens for this public key
      const now = new Date();
      for (const [hash, item] of memoryStore.entries()) {
        if (item.publicKey === record.publicKey) {
          item.revoked = true;
          item.revokedAt = now;
          item.revokedBy = "reuse";
          memoryStore.set(hash, item);
        }
      }
      return null;
    }

    if (record.expiresAt < Date.now()) {
      return null;
    }

    const now = new Date();
    record.revoked = true;
    record.revokedAt = now;
    record.revokedBy = "rotation";
    record.lastUsedAt = now;
    memoryStore.set(oldHash, record);

    return await issueTokens(
      record.publicKey,
      deviceInfo || record.deviceInfo,
      ipAddress || record.ipAddress,
      record.familyId,
    );
  }
}

/**
 * Revoke specific refresh token or session by ID.
 *
 * @param {string} token - Raw refresh token or token hash
 * @returns {Promise<boolean>}
 */
async function revokeToken(token, revokedBy = "revoke") {
  if (!token) return false;
  const hash = hashToken(token);
  const now = new Date();

  if (await isDbAvailable()) {
    const count = await knex("refresh_tokens")
      .where("token_hash", hash)
      .update({ revoked: true, revoked_at: now, revoked_by: revokedBy });
    return count > 0;
  } else {
    const record = memoryStore.get(hash);
    if (record) {
      record.revoked = true;
      record.revokedAt = now;
      record.revokedBy = revokedBy;
      memoryStore.set(hash, record);
      return true;
    }
    return false;
  }
}

/**
 * Revoke session by ID for a specific user.
 *
 * @param {number|string} sessionId
 * @param {string} publicKey
 * @returns {Promise<boolean>}
 */
async function revokeSessionById(sessionId, publicKey) {
  const idNum = parseInt(sessionId, 10);
  if (!idNum || !publicKey) return false;
  const now = new Date();

  if (await isDbAvailable()) {
    const count = await knex("refresh_tokens")
      .where({ id: idNum, public_key: publicKey })
      .update({ revoked: true, revoked_at: now, revoked_by: "session" });
    return count > 0;
  } else {
    for (const [hash, item] of memoryStore.entries()) {
      if (item.id === idNum && item.publicKey === publicKey) {
        item.revoked = true;
        item.revokedAt = now;
        item.revokedBy = "session";
        memoryStore.set(hash, item);
        return true;
      }
    }
    return false;
  }
}

/**
 * Revoke all token families / sessions for a user.
 *
 * @param {string} publicKey
 * @returns {Promise<number>} Number of revoked sessions
 */
async function revokeAllUserTokens(publicKey, revokedBy = "revoke-all") {
  if (!publicKey) return 0;
  const now = new Date();

  if (await isDbAvailable()) {
    return await knex("refresh_tokens")
      .where("public_key", publicKey)
      .where("revoked", false)
      .update({ revoked: true, revoked_at: now, revoked_by: revokedBy });
  } else {
    let count = 0;
    for (const [hash, item] of memoryStore.entries()) {
      if (item.publicKey === publicKey && !item.revoked) {
        item.revoked = true;
        item.revokedAt = now;
        item.revokedBy = revokedBy;
        memoryStore.set(hash, item);
        count++;
      }
    }
    return count;
  }
}

/**
 * Alias for revokeAllUserTokens (for backward compatibility).
 */
async function revokeTokenFamily(publicKey) {
  return await revokeAllUserTokens(publicKey, "logout");
}

/**
 * Get active sessions for a public key.
 *
 * @param {string} publicKey
 * @returns {Promise<Array<{ id: number, publicKey: string, deviceInfo: string, ipAddress: string, createdAt: string, lastUsedAt: string, expiresAt: string }>>}
 */
async function getActiveSessions(publicKey) {
  if (!publicKey) return [];

  const now = new Date();

  if (await isDbAvailable()) {
    const rows = await knex("refresh_tokens")
      .where("public_key", publicKey)
      .where("revoked", false)
      .where("expires_at", ">", now)
      .orderBy("created_at", "desc");

    return rows.map((r) => ({
      id: r.id,
      publicKey: r.public_key,
      familyId: r.family_id,
      deviceInfo: r.device_info,
      ipAddress: r.ip_address,
      createdAt: r.created_at,
      lastUsedAt: r.last_used_at,
      expiresAt: r.expires_at,
    }));
  } else {
    const results = [];
    for (const item of memoryStore.values()) {
      if (item.publicKey === publicKey && !item.revoked && item.expiresAt > Date.now()) {
        results.push({
          id: item.id,
          publicKey: item.publicKey,
          familyId: item.familyId,
          deviceInfo: item.deviceInfo,
          ipAddress: item.ipAddress,
          createdAt: item.createdAt,
          lastUsedAt: item.lastUsedAt,
          expiresAt: new Date(item.expiresAt),
        });
      }
    }
    return results.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }
}

/**
 * Get refresh token data from memory/DB.
 */
async function getRefreshTokenData(token) {
  if (!token) return null;
  const hash = hashToken(token);

  if (await isDbAvailable()) {
    const row = await knex("refresh_tokens").where("token_hash", hash).first();
    if (!row) return null;
    return {
      id: row.id,
      publicKey: row.public_key,
      familyId: row.family_id,
      revoked: Boolean(row.revoked),
      used: Boolean(row.revoked),
      revokedAt: row.revoked_at ? new Date(row.revoked_at).getTime() : null,
      revokedBy: row.revoked_by || null,
      expiresAt: new Date(row.expires_at).getTime(),
    };
  } else {
    const record = memoryStore.get(hash);
    if (!record) return null;
    return {
      id: record.id,
      publicKey: record.publicKey,
      familyId: record.familyId,
      revoked: record.revoked,
      used: record.revoked,
      revokedAt: record.revokedAt ? new Date(record.revokedAt).getTime() : null,
      revokedBy: record.revokedBy || null,
      expiresAt: record.expiresAt,
    };
  }
}

/**
 * Clear memory store and (when available) the refresh_tokens table.
 * Intended for tests so each test starts from a clean slate.
 */
async function clearAll() {
  memoryStore.clear();
  nextMemoryId = 1;
  if (await isDbAvailable()) {
    await knex("refresh_tokens").del();
  }
}

module.exports = {
  issueTokens,
  generateTokenPair: issueTokens,
  rotateRefreshToken,
  revokeToken,
  revokeSessionById,
  revokeAllUserTokens,
  revokeTokenFamily,
  getActiveSessions,
  getRefreshTokenData,
  getAccessTokenTTLSeconds,
  getRefreshTokenTTLSeconds,
  clearAll,
};

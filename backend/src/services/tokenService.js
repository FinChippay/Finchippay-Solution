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
 * Issue a new access token (15 mins) and refresh token (7 days).
 *
 * @param {string} publicKey - User's Stellar public key
 * @param {string} [deviceInfo] - Optional client device user-agent
 * @param {string} [ipAddress] - Optional client IP address
 * @returns {Promise<{ accessToken: string, refreshToken: string, expiresIn: number }>}
 */
async function issueTokens(publicKey, deviceInfo = null, ipAddress = null) {
  const accessToken = jwt.sign({ publicKey }, JWT_SECRET, { expiresIn: "15m" });
  const refreshToken = crypto.randomBytes(40).toString("hex");
  const tokenHash = hashToken(refreshToken);
  const now = new Date();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

  if (await isDbAvailable()) {
    await knex("refresh_tokens").insert({
      public_key: publicKey,
      token_hash: tokenHash,
      device_info: deviceInfo ? String(deviceInfo) : null,
      ip_address: ipAddress ? String(ipAddress) : null,
      expires_at: expiresAt,
      revoked: false,
      created_at: now,
      last_used_at: null,
    });
  } else {
    const id = nextMemoryId++;
    memoryStore.set(tokenHash, {
      id,
      publicKey,
      tokenHash,
      deviceInfo: deviceInfo ? String(deviceInfo) : null,
      ipAddress: ipAddress ? String(ipAddress) : null,
      expiresAt: expiresAt.getTime(),
      revoked: false,
      createdAt: now,
      lastUsedAt: null,
    });
  }

  return { accessToken, refreshToken, expiresIn: 900 };
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
      await knex("refresh_tokens")
        .where("public_key", record.public_key)
        .update({ revoked: true });
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
      .update({ revoked: true, last_used_at: now });

    // Issue new pair
    return await issueTokens(
      record.public_key,
      deviceInfo || record.device_info,
      ipAddress || record.ip_address,
    );
  } else {
    const record = memoryStore.get(oldHash);
    if (!record) return null;

    if (record.revoked) {
      // Replay attack: revoke all tokens for this public key
      for (const [hash, item] of memoryStore.entries()) {
        if (item.publicKey === record.publicKey) {
          item.revoked = true;
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
    record.lastUsedAt = now;
    memoryStore.set(oldHash, record);

    return await issueTokens(
      record.publicKey,
      deviceInfo || record.deviceInfo,
      ipAddress || record.ipAddress,
    );
  }
}

/**
 * Revoke specific refresh token or session by ID.
 *
 * @param {string} token - Raw refresh token or token hash
 * @returns {Promise<boolean>}
 */
async function revokeToken(token) {
  if (!token) return false;
  const hash = hashToken(token);

  if (await isDbAvailable()) {
    const count = await knex("refresh_tokens")
      .where("token_hash", hash)
      .update({ revoked: true });
    return count > 0;
  } else {
    const record = memoryStore.get(hash);
    if (record) {
      record.revoked = true;
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

  if (await isDbAvailable()) {
    const count = await knex("refresh_tokens")
      .where({ id: idNum, public_key: publicKey })
      .update({ revoked: true });
    return count > 0;
  } else {
    for (const [hash, item] of memoryStore.entries()) {
      if (item.id === idNum && item.publicKey === publicKey) {
        item.revoked = true;
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
async function revokeAllUserTokens(publicKey) {
  if (!publicKey) return 0;

  if (await isDbAvailable()) {
    return await knex("refresh_tokens")
      .where("public_key", publicKey)
      .where("revoked", false)
      .update({ revoked: true });
  } else {
    let count = 0;
    for (const [hash, item] of memoryStore.entries()) {
      if (item.publicKey === publicKey && !item.revoked) {
        item.revoked = true;
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
  return await revokeAllUserTokens(publicKey);
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
      deviceInfo: r.device_info,
      ipAddress: r.ip_address,
      createdAt: r.created_at,
      lastUsedAt: r.last_used_at,
      expiresAt: r.expires_at,
    }));
  } else {
    const results = [];
    for (const item of memoryStore.values()) {
      if (
        item.publicKey === publicKey &&
        !item.revoked &&
        item.expiresAt > Date.now()
      ) {
        results.push({
          id: item.id,
          publicKey: item.publicKey,
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
      revoked: row.revoked,
      expiresAt: new Date(row.expires_at).getTime(),
    };
  } else {
    const record = memoryStore.get(hash);
    if (!record) return null;
    return {
      id: record.id,
      publicKey: record.publicKey,
      revoked: record.revoked,
      expiresAt: record.expiresAt,
    };
  }
}

/**
 * Clear memory store (for tests).
 */
function clearAll() {
  memoryStore.clear();
  nextMemoryId = 1;
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
  clearAll,
};

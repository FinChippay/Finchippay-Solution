/**
 * src/services/tokenService.js
 * Refresh token management, rotation, and revocation service.
 */
"use strict";

const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { JWT_SECRET } = require("../middleware/auth");

// In-memory store for refresh tokens and families
// Maps refreshToken -> { publicKey, familyId, used: boolean, expiresAt: number }
const refreshTokens = new Map();

/**
 * Issue a new access token (15 mins) and refresh token (7 days).
 *
 * @param {string} publicKey - User's Stellar public key
 * @returns {{ accessToken: string, refreshToken: string }}
 */
function issueTokens(publicKey) {
  const accessToken = jwt.sign({ publicKey }, JWT_SECRET, { expiresIn: "15m" });
  const refreshToken = crypto.randomBytes(40).toString("hex");
  const familyId = crypto.randomUUID();

  refreshTokens.set(refreshToken, {
    publicKey,
    familyId,
    used: false,
    expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 days
  });

  return { accessToken, refreshToken };
}

/**
 * Rotate a refresh token. Consumes the old token and issues a new pair.
 * Detects token reuse (replay attacks) and revokes the entire family.
 *
 * @param {string} oldToken - The refresh token to rotate
 * @returns {{ accessToken: string, refreshToken: string } | null} New token pair, or null if invalid/revoked
 */
function rotateRefreshToken(oldToken) {
  const tokenData = refreshTokens.get(oldToken);
  if (!tokenData) {
    return null;
  }

  // Check expiration
  if (Date.now() > tokenData.expiresAt) {
    refreshTokens.delete(oldToken);
    return null;
  }

  // Reuse detection
  if (tokenData.used) {
    // Invalidate the entire family
    const familyId = tokenData.familyId;
    for (const [key, value] of refreshTokens.entries()) {
      if (value.familyId === familyId) {
        refreshTokens.delete(key);
      }
    }
    return null;
  }

  // Mark old token as used
  tokenData.used = true;
  refreshTokens.set(oldToken, tokenData);

  // Issue new pair with the same familyId
  const { publicKey, familyId } = tokenData;
  const accessToken = jwt.sign({ publicKey }, JWT_SECRET, { expiresIn: "15m" });
  const newRefreshToken = crypto.randomBytes(40).toString("hex");

  refreshTokens.set(newRefreshToken, {
    publicKey,
    familyId,
    used: false,
    expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
  });

  return { accessToken, refreshToken: newRefreshToken };
}

/**
 * Revoke all refresh tokens for a user (invalidating their entire token family).
 *
 * @param {string} publicKey - User's Stellar public key
 */
function revokeTokenFamily(publicKey) {
  for (const [key, value] of refreshTokens.entries()) {
    if (value.publicKey === publicKey) {
      refreshTokens.delete(key);
    }
  }
}

/**
 * Lookup refresh token details (for debugging, logout, or testing).
 *
 * @param {string} token
 * @returns {object | null}
 */
function getRefreshTokenData(token) {
  return refreshTokens.get(token) || null;
}

/**
 * Clear all stored refresh tokens (primarily for test cleanup).
 */
function clearAll() {
  refreshTokens.clear();
}

module.exports = {
  issueTokens,
  rotateRefreshToken,
  revokeTokenFamily,
  getRefreshTokenData,
  clearAll,
};

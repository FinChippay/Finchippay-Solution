/* eslint-env jest */

/**
 * backend/__tests__/authTokenRotation.test.js
 * Issue #68 — Auth Token Rotation & Revocation Hardening.
 *
 * Covers:
 *   - refresh-token rotation (each refresh issues a new token, old one dies)
 *   - token family grouping across rotations
 *   - reuse/theft detection (replaying a rotated token revokes the family)
 *   - per-device/session revocation with revoked_at / revoked_by metadata
 *   - configurable, short-by-default access-token TTL
 *   - refresh tokens stored hashed at rest (never plaintext)
 */
"use strict";

const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const tokenService = require("../src/services/tokenService");
const { JWT_SECRET } = require("../src/middleware/auth");
const knex = require("../src/db/connection");

const PK1 = "GA2H2V337B66T2O5S5V3Z4P6B6L7M8N9P0Q1R2S3T4U5V6W7X8Y9Z012";
const PK2 = "GB3H3V337B66T2O5S5V3Z4P6B6L7M8N9P0Q1R2S3T4U5V6W7X8Y9Z034";

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

describe("refresh token rotation (#68)", () => {
  beforeEach(async () => {
    await tokenService.clearAll();
  });

  test("rotates the refresh token and invalidates the previous one", async () => {
    const pair1 = await tokenService.issueTokens(PK1, "UA-1", "1.1.1.1");
    const pair2 = await tokenService.rotateRefreshToken(pair1.refreshToken, "UA-1", "1.1.1.1");

    expect(pair2).not.toBeNull();
    expect(pair2.refreshToken).not.toBe(pair1.refreshToken);
    expect(pair2.accessToken).not.toBe(pair1.accessToken);

    // The old token is marked used/revoked and can never be used again.
    const oldData = await tokenService.getRefreshTokenData(pair1.refreshToken);
    expect(oldData).not.toBeNull();
    expect(oldData.revoked).toBe(true);
    expect(oldData.used).toBe(true);
    expect(oldData.revokedBy).toBe("rotation");
    expect(oldData.revokedAt).not.toBeNull();

    // The rotated-out token must not rotate again.
    const replay = await tokenService.rotateRefreshToken(pair1.refreshToken);
    expect(replay).toBeNull();
  });

  test("successive rotations keep the same token family", async () => {
    const pair1 = await tokenService.issueTokens(PK1, "UA-1", "1.1.1.1");
    const pair2 = await tokenService.rotateRefreshToken(pair1.refreshToken, "UA-1", "1.1.1.1");
    const pair3 = await tokenService.rotateRefreshToken(pair2.refreshToken, "UA-1", "1.1.1.1");

    expect(pair2).not.toBeNull();
    expect(pair3).not.toBeNull();

    const d1 = await tokenService.getRefreshTokenData(pair1.refreshToken);
    const d2 = await tokenService.getRefreshTokenData(pair2.refreshToken);
    const d3 = await tokenService.getRefreshTokenData(pair3.refreshToken);

    expect(d1.familyId).toBeTruthy();
    expect(d1.familyId).toBe(d2.familyId);
    expect(d2.familyId).toBe(d3.familyId);

    // Only the latest token of the chain is still active.
    expect(d1.revoked).toBe(true);
    expect(d2.revoked).toBe(true);
    expect(d3.revoked).toBe(false);
  });

  test("rotated access token is a valid JWT for the same user with a short TTL", async () => {
    const pair1 = await tokenService.issueTokens(PK1, "UA-1", "1.1.1.1");
    const pair2 = await tokenService.rotateRefreshToken(pair1.refreshToken, "UA-1", "1.1.1.1");

    const decoded = jwt.verify(pair2.accessToken, JWT_SECRET);
    expect(decoded.publicKey).toBe(PK1);
    // TTL is short by default and matches the configured value.
    expect(decoded.exp - decoded.iat).toBe(tokenService.getAccessTokenTTLSeconds());
    expect(tokenService.getAccessTokenTTLSeconds()).toBeLessThanOrEqual(15 * 60);
  });

  test("rotation inherits device info when none is supplied", async () => {
    const pair1 = await tokenService.issueTokens(PK1, "iPhone Safari", "10.0.0.1");
    const pair2 = await tokenService.rotateRefreshToken(pair1.refreshToken);

    expect(pair2).not.toBeNull();

    const sessions = await tokenService.getActiveSessions(PK1);
    expect(sessions.length).toBe(1);
    expect(sessions[0].deviceInfo).toBe("iPhone Safari");
    expect(sessions[0].ipAddress).toBe("10.0.0.1");
  });

  test("rotation of an unknown or expired refresh token returns null", async () => {
    expect(await tokenService.rotateRefreshToken("definitely-not-a-token")).toBeNull();

    const pair = await tokenService.issueTokens(PK1, "UA-1", "1.1.1.1");
    // Force the refresh token to expire in the DB.
    await knex("refresh_tokens")
      .where("token_hash", sha256(pair.refreshToken))
      .update({ expires_at: new Date(Date.now() - 1000) });

    expect(await tokenService.rotateRefreshToken(pair.refreshToken)).toBeNull();
  });
});

describe("refresh token reuse / theft detection (#68)", () => {
  beforeEach(async () => {
    await tokenService.clearAll();
  });

  test("reuse of a rotated refresh token revokes the entire family", async () => {
    const pair1 = await tokenService.issueTokens(PK1, "UA-1", "1.1.1.1");
    const pair2 = await tokenService.rotateRefreshToken(pair1.refreshToken, "UA-1", "1.1.1.1");
    expect(pair2).not.toBeNull();

    // Attacker replays the rotated-out token.
    const replay = await tokenService.rotateRefreshToken(pair1.refreshToken, "Attacker", "9.9.9.9");
    expect(replay).toBeNull();

    // The whole family is dead — the successor cannot rotate either.
    expect(await tokenService.rotateRefreshToken(pair2.refreshToken)).toBeNull();
    expect(await tokenService.getActiveSessions(PK1)).toHaveLength(0);
  });

  test("reuse of a rotated token revokes every session of the user and records the theft", async () => {
    const pair1 = await tokenService.issueTokens(PK1, "Device A", "1.1.1.1");
    const pair2 = await tokenService.rotateRefreshToken(pair1.refreshToken, "Device A", "1.1.1.1");
    const otherSession = await tokenService.issueTokens(PK1, "Device B", "2.2.2.2");

    expect(pair2).not.toBeNull();
    expect(otherSession).not.toBeNull();
    expect(await tokenService.getActiveSessions(PK1)).toHaveLength(2);

    // Replay the rotated-out token: theft signal.
    const replay = await tokenService.rotateRefreshToken(pair1.refreshToken);
    expect(replay).toBeNull();

    // Every session (including Device B, a separate family) is revoked.
    expect(await tokenService.getActiveSessions(PK1)).toHaveLength(0);

    const familyData = await tokenService.getRefreshTokenData(pair2.refreshToken);
    expect(familyData.revoked).toBe(true);
    expect(familyData.revokedBy).toBe("reuse");
    expect(familyData.revokedAt).not.toBeNull();
  });
});

describe("per-device / session revocation (#68)", () => {
  beforeEach(async () => {
    await tokenService.clearAll();
  });

  test("revokeToken revokes a single device/session, leaving others active", async () => {
    const deviceA = await tokenService.issueTokens(PK1, "Device A", "1.1.1.1");
    const deviceB = await tokenService.issueTokens(PK1, "Device B", "2.2.2.2");

    const revoked = await tokenService.revokeToken(deviceA.refreshToken);
    expect(revoked).toBe(true);

    const sessions = await tokenService.getActiveSessions(PK1);
    expect(sessions.length).toBe(1);
    expect(sessions[0].deviceInfo).toBe("Device B");

    // The untouched device/session keeps working and can still rotate.
    expect(await tokenService.rotateRefreshToken(deviceB.refreshToken)).not.toBeNull();
  });

  test("revokeSessionById removes access for a specific session only", async () => {
    await tokenService.issueTokens(PK1, "Device A", "1.1.1.1");
    await tokenService.issueTokens(PK1, "Device B", "2.2.2.2");

    const sessions = await tokenService.getActiveSessions(PK1);
    expect(sessions.length).toBe(2);
    const target = sessions.find((s) => s.deviceInfo === "Device A");
    expect(target).toBeDefined();

    const success = await tokenService.revokeSessionById(target.id, PK1);
    expect(success).toBe(true);

    const after = await tokenService.getActiveSessions(PK1);
    expect(after.length).toBe(1);
    expect(after[0].deviceInfo).toBe("Device B");

    // Metadata records who/what revoked the session.
    const row = await knex("refresh_tokens").where("id", target.id).first();
    expect(row.revoked).toBeTruthy();
    expect(row.revoked_by).toBe("session");
    expect(row.revoked_at).not.toBeNull();
  });

  test("revokeTokenFamily (logout) revokes all sessions for the user", async () => {
    await tokenService.issueTokens(PK1, "Device A", "1.1.1.1");
    await tokenService.issueTokens(PK1, "Device B", "2.2.2.2");
    await tokenService.issueTokens(PK2, "Device C", "3.3.3.3");

    await tokenService.revokeTokenFamily(PK1);

    expect(await tokenService.getActiveSessions(PK1)).toHaveLength(0);
    // Other users are unaffected.
    expect(await tokenService.getActiveSessions(PK2)).toHaveLength(1);
  });
});

describe("access-token TTL (#68)", () => {
  beforeEach(async () => {
    await tokenService.clearAll();
  });

  test("access token TTL is short by default and matches the signed expiry", async () => {
    const ttl = tokenService.getAccessTokenTTLSeconds();
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(15 * 60);

    const pair = await tokenService.issueTokens(PK1);
    const decoded = jwt.verify(pair.accessToken, JWT_SECRET);
    expect(decoded.exp - decoded.iat).toBe(ttl);
    expect(pair.expiresIn).toBe(ttl);
  });

  test("access token TTL is configurable via ACCESS_TOKEN_TTL", async () => {
    const original = process.env.ACCESS_TOKEN_TTL;
    process.env.ACCESS_TOKEN_TTL = "5m";
    try {
      const pair = await tokenService.issueTokens(PK1);
      const decoded = jwt.verify(pair.accessToken, JWT_SECRET);
      expect(decoded.exp - decoded.iat).toBe(300);
      expect(pair.expiresIn).toBe(300);
    } finally {
      if (original === undefined) {
        delete process.env.ACCESS_TOKEN_TTL;
      } else {
        process.env.ACCESS_TOKEN_TTL = original;
      }
    }
  });
});

describe("refresh token storage (#68)", () => {
  beforeEach(async () => {
    await tokenService.clearAll();
  });

  test("refresh tokens are stored hashed at rest, never in plaintext", async () => {
    const pair = await tokenService.issueTokens(PK1, "UA-1", "1.1.1.1");

    const row = await knex("refresh_tokens").where("token_hash", sha256(pair.refreshToken)).first();

    expect(row).toBeDefined();
    expect(row.token_hash).not.toBe(pair.refreshToken);
    expect(row.token_hash).toBe(sha256(pair.refreshToken));
    expect(row.family_id).toBeTruthy();
    expect(row.revoked).toBeFalsy();
    expect(row.revoked_at).toBeNull();

    // The raw token must never appear anywhere in the stored record.
    const rawHits = await knex("refresh_tokens")
      .where("token_hash", pair.refreshToken)
      .orWhere("token_hash", "like", `%${pair.refreshToken.slice(0, 16)}%`);
    expect(rawHits.length).toBe(0);
  });
});

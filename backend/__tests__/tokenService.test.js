/* eslint-env jest */

/**
 * backend/__tests__/tokenService.test.js
 * Comprehensive unit tests for refresh token rotation, revocation, and session management.
 */
"use strict";

const tokenService = require("../src/services/tokenService");

describe("tokenService", () => {
  const testPublicKey = "GA2H2V337B66T2O5S5V3Z4P6B6L7M8N9P0Q1R2S3T4U5V6W7X8Y9Z012";
  const testPublicKey2 = "GB3H3V337B66T2O5S5V3Z4P6B6L7M8N9P0Q1R2S3T4U5V6W7X8Y9Z034";

  beforeEach(async () => {
    await tokenService.clearAll();
  });

  test("issueTokens returns valid accessToken and refreshToken pair", async () => {
    const pair = await tokenService.issueTokens(testPublicKey, "Mozilla/5.0", "127.0.0.1");

    expect(pair).toHaveProperty("accessToken");
    expect(pair).toHaveProperty("refreshToken");
    expect(pair.expiresIn).toBe(tokenService.getAccessTokenTTLSeconds());
    expect(typeof pair.accessToken).toBe("string");
    expect(typeof pair.refreshToken).toBe("string");
  });

  test("rotateRefreshToken consumes old token and issues new pair", async () => {
    const initialPair = await tokenService.issueTokens(testPublicKey, "Mozilla/5.0", "127.0.0.1");
    const rotatedPair = await tokenService.rotateRefreshToken(
      initialPair.refreshToken,
      "Mozilla/5.0",
      "127.0.0.1",
    );

    expect(rotatedPair).not.toBeNull();
    expect(rotatedPair.accessToken).toBeDefined();
    expect(rotatedPair.refreshToken).toBeDefined();
    expect(rotatedPair.refreshToken).not.toBe(initialPair.refreshToken);
  });

  test("replay attack detection: using a revoked refresh token revokes all user sessions", async () => {
    // 1. User logs in, gets Pair 1
    const pair1 = await tokenService.issueTokens(testPublicKey, "Mozilla/5.0", "127.0.0.1");

    // 2. Normal rotation -> Pair 2 (Pair 1 is now marked revoked)
    const pair2 = await tokenService.rotateRefreshToken(
      pair1.refreshToken,
      "Mozilla/5.0",
      "127.0.0.1",
    );
    expect(pair2).not.toBeNull();

    // 3. User creates a second session (Pair 3) from another device
    const pair3 = await tokenService.issueTokens(testPublicKey, "Safari", "192.168.1.1");
    expect(pair3).not.toBeNull();

    // Verify user has active sessions
    let sessions = await tokenService.getActiveSessions(testPublicKey);
    expect(sessions.length).toBeGreaterThan(0);

    // 4. Attacker attempts to replay old Pair 1 refresh token
    const replayed = await tokenService.rotateRefreshToken(
      pair1.refreshToken,
      "Attacker",
      "1.2.3.4",
    );
    expect(replayed).toBeNull();

    // 5. Replay detection MUST revoke ALL sessions for this user (Pair 2 & Pair 3 become invalid)
    sessions = await tokenService.getActiveSessions(testPublicKey);
    expect(sessions.length).toBe(0);

    // Attempting to rotate Pair 2 or Pair 3 should now fail
    const pair2Rotation = await tokenService.rotateRefreshToken(pair2.refreshToken);
    expect(pair2Rotation).toBeNull();
  });

  test("revokeSessionById revokes individual session", async () => {
    await tokenService.issueTokens(testPublicKey, "Device 1", "127.0.0.1");
    await tokenService.issueTokens(testPublicKey, "Device 2", "127.0.0.2");

    let sessions = await tokenService.getActiveSessions(testPublicKey);
    expect(sessions.length).toBe(2);

    const sessionToRevoke = sessions.find((s) => s.deviceInfo === "Device 1");
    expect(sessionToRevoke).toBeDefined();

    const success = await tokenService.revokeSessionById(sessionToRevoke.id, testPublicKey);
    expect(success).toBe(true);

    sessions = await tokenService.getActiveSessions(testPublicKey);
    expect(sessions.length).toBe(1);
    expect(sessions[0].deviceInfo).toBe("Device 2");
  });

  test("revokeAllUserTokens invalidates all sessions for that user only", async () => {
    await tokenService.issueTokens(testPublicKey, "Device 1", "127.0.0.1");
    await tokenService.issueTokens(testPublicKey, "Device 2", "127.0.0.2");
    await tokenService.issueTokens(testPublicKey2, "Device 3", "127.0.0.3");

    let user1Sessions = await tokenService.getActiveSessions(testPublicKey);
    let user2Sessions = await tokenService.getActiveSessions(testPublicKey2);
    expect(user1Sessions.length).toBe(2);
    expect(user2Sessions.length).toBe(1);

    await tokenService.revokeAllUserTokens(testPublicKey);

    user1Sessions = await tokenService.getActiveSessions(testPublicKey);
    user2Sessions = await tokenService.getActiveSessions(testPublicKey2);
    expect(user1Sessions.length).toBe(0);
    expect(user2Sessions.length).toBe(1);
  });
});

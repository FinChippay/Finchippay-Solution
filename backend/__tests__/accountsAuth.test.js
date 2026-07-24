/**
 * #278 — account-data routes must require a SEP-10 JWT and only allow access to
 * the caller's own account.
 */
"use strict";

const express = require("express");
const request = require("supertest");
const jwt = require("jsonwebtoken");
const { JWT_SECRET } = require("../src/middleware/auth");
const accountRoutes = require("../src/routes/accounts");
const authRoutes = require("../src/routes/auth");
const tokenService = require("../src/services/tokenService");

const ME = "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUWDA";
const OTHER = "GDUKMGUGDZQK6YHYA5Z6AY2G4XDSZPSZ3SW5UN3ARVMO6QSRDWP5YLEX";

function appWithAccounts() {
  const app = express();
  app.use(express.json());
  app.use("/api/accounts", accountRoutes);
  return app;
}

function tokenFor(publicKey) {
  return jwt.sign({ publicKey }, JWT_SECRET, { expiresIn: "1h" });
}

describe("account routes authorization (#278)", () => {
  const app = appWithAccounts();

  it("rejects an unauthenticated account request with 401", async () => {
    const res = await request(app).get(`/api/accounts/${ME}`);
    expect(res.status).toBe(401);
  });

  it("rejects accessing another account's data with 403", async () => {
    const res = await request(app)
      .get(`/api/accounts/${OTHER}`)
      .set("Authorization", `Bearer ${tokenFor(ME)}`);
    expect(res.status).toBe(403);
  });

  it("rejects the balance route without a token", async () => {
    const res = await request(app).get(`/api/accounts/${ME}/balance`);
    expect(res.status).toBe(401);
  });
});

describe("SEP-0010 token refresh and rotation (#132)", () => {
  let app;

  beforeEach(() => {
    tokenService.clearAll();
    app = express();
    app.use(express.json());
    app.use("/api/auth", authRoutes);
    app.use("/api/accounts", accountRoutes);
  });

  it("verifies access token expires and returns TOKEN_EXPIRED code", async () => {
    // Generate a token that is already expired
    const expiredToken = jwt.sign({ publicKey: ME }, JWT_SECRET, { expiresIn: "-1s" });

    const res = await request(app)
      .get(`/api/accounts/${ME}`)
      .set("Authorization", `Bearer ${expiredToken}`);

    expect(res.status).toBe(401);
    expect(res.body.error).toHaveProperty("code", "TOKEN_EXPIRED");
  });

  it("POST /api/auth/refresh returns new token pair for valid refresh tokens", async () => {
    const { accessToken, refreshToken } = tokenService.issueTokens(ME);

    const res = await request(app)
      .post("/api/auth/refresh")
      .send({ refreshToken });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("success", true);
    expect(res.body).toHaveProperty("accessToken");
    expect(res.body).toHaveProperty("refreshToken");

    // Ensure the old refresh token was rotated out and marked as used
    const oldTokenData = tokenService.getRefreshTokenData(refreshToken);
    expect(oldTokenData.used).toBe(true);
  });

  it("reuse of a refresh token invalidates the entire family", async () => {
    const { accessToken, refreshToken } = tokenService.issueTokens(ME);

    // First refresh - successful
    const res1 = await request(app)
      .post("/api/auth/refresh")
      .send({ refreshToken });

    expect(res1.status).toBe(200);
    const nextRefreshToken = res1.body.refreshToken;

    // Re-use of the original refresh token (replay attack)
    const res2 = await request(app)
      .post("/api/auth/refresh")
      .send({ refreshToken });

    expect(res2.status).toBe(401);

    // Verify the entire family is now invalidated (nextRefreshToken is also deleted/invalid)
    const res3 = await request(app)
      .post("/api/auth/refresh")
      .send({ refreshToken: nextRefreshToken });

    expect(res3.status).toBe(401);
  });

  it("POST /api/auth/logout revokes all tokens", async () => {
    const { accessToken, refreshToken } = tokenService.issueTokens(ME);

    const resLogout = await request(app)
      .post("/api/auth/logout")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ refreshToken });

    expect(resLogout.status).toBe(200);

    // Subsequent refresh should fail
    const resRefresh = await request(app)
      .post("/api/auth/refresh")
      .send({ refreshToken });

    expect(resRefresh.status).toBe(401);
  });
});

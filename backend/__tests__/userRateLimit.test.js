/* eslint-env jest */
"use strict";

const request = require("supertest");
const express = require("express");
const { userLimiter } = require("../src/middleware/userRateLimit");

describe("User Rate Limiter", () => {
  let app;

  beforeEach(() => {
    app = express();
    // trust proxy to respect X-Forwarded-For
    app.set("trust proxy", 1);

    // Mock auth middleware that populates req.user.sub
    app.use(
      "/api/auth-endpoint",
      (req, res, next) => {
        const authHeader = req.headers.authorization;
        if (authHeader) {
          req.user = { sub: authHeader.split(" ")[1] };
        }
        next();
      },
      userLimiter,
      (req, res) => {
        res.status(200).json({ ok: true });
      },
    );

    // Mock unauthenticated endpoint
    app.use("/api/public-endpoint", userLimiter, (req, res) => {
      res.status(200).json({ ok: true });
    });
  });

  it("should allow requests under the limit for an authenticated user", async () => {
    const res1 = await request(app).get("/api/auth-endpoint").set("Authorization", "Bearer UserA");

    expect(res1.status).toBe(200);
    expect(res1.headers["x-ratelimit-user-remaining"]).toBe("29");

    const res2 = await request(app).get("/api/auth-endpoint").set("Authorization", "Bearer UserA");

    expect(res2.status).toBe(200);
    expect(res2.headers["x-ratelimit-user-remaining"]).toBe("28");
  });

  it("should block requests over the limit for an authenticated user", async () => {
    // Send 30 requests
    for (let i = 0; i < 30; i++) {
      await request(app).get("/api/auth-endpoint").set("Authorization", "Bearer UserB");
    }

    // 31st request should be blocked
    const res = await request(app).get("/api/auth-endpoint").set("Authorization", "Bearer UserB");

    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe("RATE_LIMITED_USER");
    expect(res.body.error.message).toBe("Too many requests from this account");
    // Standard express-rate-limit headers should NOT be present
    expect(res.headers["ratelimit-remaining"]).toBeUndefined();
  });

  it("should track limits independently for different users", async () => {
    for (let i = 0; i < 30; i++) {
      await request(app).get("/api/auth-endpoint").set("Authorization", "Bearer UserC");
    }

    // UserC is blocked
    const resC = await request(app).get("/api/auth-endpoint").set("Authorization", "Bearer UserC");
    expect(resC.status).toBe(429);

    // UserD is not blocked
    const resD = await request(app).get("/api/auth-endpoint").set("Authorization", "Bearer UserD");
    expect(resD.status).toBe(200);
    expect(resD.headers["x-ratelimit-user-remaining"]).toBe("29");
  });

  it("should fallback to IP for unauthenticated requests", async () => {
    // Send 30 requests from IP
    for (let i = 0; i < 30; i++) {
      await request(app).get("/api/public-endpoint").set("X-Forwarded-For", "1.2.3.4");
    }

    // 31st is blocked
    const res1 = await request(app).get("/api/public-endpoint").set("X-Forwarded-For", "1.2.3.4");
    expect(res1.status).toBe(429);

    // Different IP is not blocked
    const res2 = await request(app).get("/api/public-endpoint").set("X-Forwarded-For", "5.6.7.8");
    expect(res2.status).toBe(200);
  });
});

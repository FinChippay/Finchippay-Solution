/* eslint-env jest */
/**
 * __tests__/healthDependencies.test.js
 * Verifies GET /health/dependencies is gated by the real auth middleware
 * (verifyJWT + requireAdmin), mirroring the pattern used in
 * rateLimitMetrics.test.js for other admin-only routes. Unlike
 * health.test.js, auth is NOT mocked here — a real JWT is signed and
 * ADMIN_PUBLIC_KEYS is set so the allowlist check has something to check.
 */

"use strict";

const express = require("express");
const jwt = require("jsonwebtoken");
const request = require("supertest");

jest.mock("../src/services/healthService");
const healthService = require("../src/services/healthService");

const ORIGINAL_ADMIN_PUBLIC_KEYS = process.env.ADMIN_PUBLIC_KEYS;

const ADMIN_PUBLIC_KEY = `G${"B".repeat(55)}`;
const NON_ADMIN_PUBLIC_KEY = `G${"A".repeat(55)}`;

beforeAll(() => {
  process.env.ADMIN_PUBLIC_KEYS = ADMIN_PUBLIC_KEY;
});

afterAll(() => {
  if (ORIGINAL_ADMIN_PUBLIC_KEYS === undefined) {
    delete process.env.ADMIN_PUBLIC_KEYS;
  } else {
    process.env.ADMIN_PUBLIC_KEYS = ORIGINAL_ADMIN_PUBLIC_KEYS;
  }
});

function createApp() {
  const app = express();
  const healthRoutes = require("../src/routes/health");
  app.use("/health", healthRoutes);
  return app;
}

describe("GET /health/dependencies — requireAdmin gating", () => {
  beforeEach(() => {
    healthService.runAllChecks.mockResolvedValue({
      postgres: { status: "healthy", latency: 5, message: "PostgreSQL is reachable" },
    });
  });

  it("rejects requests without a JWT", async () => {
    const res = await request(createApp()).get("/health/dependencies");

    expect(res.status).toBe(401);
    expect(res.body.error?.code).toBe("AUTH_MISSING_HEADER");
  });

  it("rejects an authenticated account outside the admin allowlist", async () => {
    const { JWT_SECRET } = require("../src/middleware/auth");
    const token = jwt.sign({ publicKey: NON_ADMIN_PUBLIC_KEY }, JWT_SECRET, {
      expiresIn: "5m",
    });

    const res = await request(createApp())
      .get("/health/dependencies")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(403);
    expect(res.body.error?.code).toBe("AUTH_FORBIDDEN");
  });

  it("returns dependency status to an allowlisted admin", async () => {
    const { JWT_SECRET } = require("../src/middleware/auth");
    const token = jwt.sign({ publicKey: ADMIN_PUBLIC_KEY }, JWT_SECRET, {
      expiresIn: "5m",
    });

    const res = await request(createApp())
      .get("/health/dependencies")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.dependencies.postgres.status).toBe("healthy");
  });
});

/**
 * __tests__/health.test.js
 * Unit tests for GET /health (liveness) and GET /health/ready (readiness).
 *
 * healthService is mocked so no real network calls are made, which means the
 * tests run fast and are fully deterministic.
 */

"use strict";

const request = require("supertest");

// ─── Mock healthService before requiring the app ────────────────────────────
jest.mock("../src/services/healthService");
const { checkDependencies } = require("../src/services/healthService");

// ─── Mock auth middleware (standard pattern across the test suite) ────────────
jest.mock("../src/middleware/auth", () => ({
  verifyJWT: (_req, _res, next) => next(),
}));

const app = require("../src/server");

// ─────────────────────────────────────────────────────────────────────────────

describe("GET /health — liveness probe", () => {
  it("returns 200 with status ok", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });

  it("includes uptime as a non-negative number", async () => {
    const res = await request(app).get("/health");
    expect(typeof res.body.uptime).toBe("number");
    expect(res.body.uptime).toBeGreaterThanOrEqual(0);
  });

  it("includes timestamp in ISO 8601 format", async () => {
    const res = await request(app).get("/health");
    expect(res.body.timestamp).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
    );
  });

  it("does NOT call checkDependencies (no external I/O)", async () => {
    await request(app).get("/health");
    expect(checkDependencies).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("GET /health/ready — readiness probe", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("when all dependencies are reachable", () => {
    beforeEach(() => {
      checkDependencies.mockResolvedValue({
        healthy: true,
        dependencies: {
          horizon: { status: "ok", latencyMs: 45 },
        },
      });
    });

    it("returns HTTP 200", async () => {
      const res = await request(app).get("/health/ready");
      expect(res.status).toBe(200);
    });

    it("returns status ok", async () => {
      const res = await request(app).get("/health/ready");
      expect(res.body.status).toBe("ok");
    });

    it("includes horizon dependency with status ok and latencyMs", async () => {
      const res = await request(app).get("/health/ready");
      expect(res.body.dependencies.horizon.status).toBe("ok");
      expect(typeof res.body.dependencies.horizon.latencyMs).toBe("number");
    });
  });

  // ── Horizon unreachable ────────────────────────────────────────────────────

  describe("when Horizon is unreachable", () => {
    beforeEach(() => {
      checkDependencies.mockResolvedValue({
        healthy: false,
        dependencies: {
          horizon: {
            status: "error",
            latencyMs: 5001,
            error: "connect ECONNREFUSED 127.0.0.1:80",
          },
        },
      });
    });

    it("returns HTTP 503", async () => {
      const res = await request(app).get("/health/ready");
      expect(res.status).toBe(503);
    });

    it("returns status error in body", async () => {
      const res = await request(app).get("/health/ready");
      expect(res.body.status).toBe("error");
    });

    it("reports horizon dependency as error", async () => {
      const res = await request(app).get("/health/ready");
      expect(res.body.dependencies.horizon.status).toBe("error");
    });

    it("includes an error message for the failing dependency", async () => {
      const res = await request(app).get("/health/ready");
      expect(typeof res.body.dependencies.horizon.error).toBe("string");
      expect(res.body.dependencies.horizon.error.length).toBeGreaterThan(0);
    });
  });

  // ── Horizon times out ─────────────────────────────────────────────────────

  describe("when Horizon times out", () => {
    beforeEach(() => {
      checkDependencies.mockResolvedValue({
        healthy: false,
        dependencies: {
          horizon: {
            status: "error",
            latencyMs: 5000,
            error: "timed out after 5000 ms",
          },
        },
      });
    });

    it("returns HTTP 503", async () => {
      const res = await request(app).get("/health/ready");
      expect(res.status).toBe(503);
    });

    it("includes timeout error message", async () => {
      const res = await request(app).get("/health/ready");
      expect(res.body.dependencies.horizon.error).toMatch(/timed out/i);
    });
  });

  // ── Soroban RPC configured and healthy ────────────────────────────────────

  describe("when Soroban RPC is configured and reachable", () => {
    beforeEach(() => {
      checkDependencies.mockResolvedValue({
        healthy: true,
        dependencies: {
          horizon: { status: "ok", latencyMs: 40 },
          soroban_rpc: { status: "ok", latencyMs: 120 },
        },
      });
    });

    it("returns HTTP 200", async () => {
      const res = await request(app).get("/health/ready");
      expect(res.status).toBe(200);
    });

    it("includes soroban_rpc in dependencies", async () => {
      const res = await request(app).get("/health/ready");
      expect(res.body.dependencies.soroban_rpc.status).toBe("ok");
      expect(typeof res.body.dependencies.soroban_rpc.latencyMs).toBe("number");
    });
  });

  // ── Soroban RPC configured but unreachable ────────────────────────────────

  describe("when Soroban RPC is unreachable", () => {
    beforeEach(() => {
      checkDependencies.mockResolvedValue({
        healthy: false,
        dependencies: {
          horizon: { status: "ok", latencyMs: 40 },
          soroban_rpc: {
            status: "error",
            latencyMs: 5001,
            error: "timed out after 5000 ms",
          },
        },
      });
    });

    it("returns HTTP 503", async () => {
      const res = await request(app).get("/health/ready");
      expect(res.status).toBe(503);
    });

    it("reports soroban_rpc dependency as error", async () => {
      const res = await request(app).get("/health/ready");
      expect(res.body.dependencies.soroban_rpc.status).toBe("error");
    });
  });

  // ── checkDependencies rejects unexpectedly ────────────────────────────────

  describe("when checkDependencies throws an unexpected error", () => {
    beforeEach(() => {
      checkDependencies.mockRejectedValue(
        new Error("unexpected internal error"),
      );
    });

    // The Express error handler should convert unhandled rejections to 500.
    it("returns HTTP 500", async () => {
      const res = await request(app).get("/health/ready");
      expect(res.status).toBe(500);
    });
  });
});

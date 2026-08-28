/* eslint-env jest */
/**
 * __tests__/health.test.js
 * Unit tests for the health check endpoints:
 *   GET /health              — legacy liveness alias
 *   GET /health/live         — liveness probe
 *   GET /health/ready        — readiness probe
 *   GET /health/started      — startup probe
 *   GET /health/dependencies — admin dependency status page
 *
 * healthService is mocked so no real network/DB/Redis calls are made, which
 * means the tests run fast and are fully deterministic. requireAdmin gating
 * for GET /health/dependencies is covered separately in
 * __tests__/healthDependencies.test.js, which exercises the real auth
 * middleware instead of the pass-through mock used here.
 */

/* eslint-env jest */
"use strict";

const request = require("supertest");

// ─── Mock healthService before requiring the app ────────────────────────────
jest.mock("../src/services/healthService");
const healthService = require("../src/services/healthService");

jest.mock("../src/middleware/auth", () => ({
  verifyJWT: (_req, _res, next) => next(),
  requireAdmin: (_req, _res, next) => next(),
}));

const app = require("../src/server");
const shutdownState = require("../src/services/shutdownState");

function healthy(latency = 10, message = "ok") {
  return { status: "healthy", latency, message };
}
function degraded(latency = 50, message = "degraded") {
  return { status: "degraded", latency, message };
}
function unhealthy(latency = 0, message = "unavailable") {
  return { status: "unhealthy", latency, message };
}

afterEach(() => {
  jest.clearAllMocks();
  shutdownState.resetForTests();
});

// ─────────────────────────────────────────────────────────────────────────────

describe("GET /health — legacy liveness alias", () => {
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
    expect(res.body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it("does NOT call any dependency checks (no external I/O)", async () => {
    await request(app).get("/health");
    expect(healthService.checkPostgres).not.toHaveBeenCalled();
    expect(healthService.checkEventLoop).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("GET /health/live — liveness probe", () => {
  it("returns 200 with status alive when event loop lag is healthy", async () => {
    healthService.checkEventLoop.mockResolvedValue(healthy(2, "Event loop lag 2 ms"));

    const res = await request(app).get("/health/live");

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("alive");
    expect(typeof res.body.uptime).toBe("number");
  });

  it("returns 200 with status alive when event loop lag is only degraded", async () => {
    healthService.checkEventLoop.mockResolvedValue(degraded(60, "Event loop lag 60 ms"));

    const res = await request(app).get("/health/live");

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("alive");
  });

  it("returns 503 with status unhealthy when event loop lag is unhealthy", async () => {
    healthService.checkEventLoop.mockResolvedValue(unhealthy(500, "Event loop lag 500 ms"));

    const res = await request(app).get("/health/live");

    expect(res.status).toBe(503);
    expect(res.body.status).toBe("unhealthy");
  });

  it("does not run readiness dependency checks", async () => {
    healthService.checkEventLoop.mockResolvedValue(healthy());
    await request(app).get("/health/live");
    expect(healthService.checkPostgres).not.toHaveBeenCalled();
    expect(healthService.checkRedis).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("GET /health/ready — readiness probe", () => {
  function mockAllChecks({ postgres, redis, horizon, sorobanRpc, diskSpace }) {
    healthService.checkPostgres.mockResolvedValue(postgres);
    healthService.checkRedis.mockResolvedValue(redis);
    healthService.checkHorizon.mockResolvedValue(horizon);
    healthService.checkSorobanRpc.mockResolvedValue(sorobanRpc);
    healthService.checkDiskSpace.mockResolvedValue(diskSpace);
  }

  describe("when all dependencies are healthy", () => {
    beforeEach(() => {
      mockAllChecks({
        postgres: healthy(5),
        redis: healthy(3),
        horizon: healthy(45),
        sorobanRpc: healthy(0, "SOROBAN_RPC_URL not configured; check skipped"),
        diskSpace: healthy(1),
      });
    });

    it("returns status ready and summary all_healthy", async () => {
      const res = await request(app).get("/health/ready");
      expect(res.body.status).toBe("ready");
      expect(res.body.summary).toBe("all_healthy");
    });

    it("includes all five checks with latency numbers", async () => {
      const res = await request(app).get("/health/ready");
      expect(res.body.checks.postgres.status).toBe("healthy");
      expect(typeof res.body.checks.postgres.latency).toBe("number");
      expect(res.body.checks.redis.status).toBe("healthy");
      expect(res.body.checks.horizon.status).toBe("healthy");
      expect(res.body.checks.soroban_rpc.status).toBe("healthy");
      expect(res.body.checks.disk_space.status).toBe("healthy");
    });
  });

  describe("when a non-critical dependency is degraded", () => {
    beforeEach(() => {
      mockAllChecks({
        postgres: healthy(5),
        redis: healthy(3),
        horizon: healthy(45),
        sorobanRpc: degraded(1200, "elevated latency"),
        diskSpace: healthy(1),
      });
    });

    it("still returns HTTP 200 (ready)", async () => {
      const res = await request(app).get("/health/ready");
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("ready");
    });

    it("reports summary degraded", async () => {
      const res = await request(app).get("/health/ready");
      expect(res.body.summary).toBe("degraded");
    });
  });

  describe("when disk space is degraded", () => {
    beforeEach(() => {
      mockAllChecks({
        postgres: healthy(5),
        redis: healthy(3),
        horizon: healthy(45),
        sorobanRpc: healthy(0),
        diskSpace: degraded(1, "Disk usage 85.0% at /"),
      });
    });

    it("returns HTTP 200 with summary degraded", async () => {
      const res = await request(app).get("/health/ready");
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("ready");
      expect(res.body.summary).toBe("degraded");
    });
  });

  describe("when PostgreSQL is unhealthy", () => {
    beforeEach(() => {
      mockAllChecks({
        postgres: unhealthy(5001, "timed out after 5000 ms"),
        redis: healthy(3),
        horizon: healthy(45),
        sorobanRpc: healthy(0),
        diskSpace: healthy(1),
      });
    });

    it("returns status not_ready and summary critical_failure", async () => {
      const res = await request(app).get("/health/ready");
      expect(res.body.status).toBe("not_ready");
      expect(res.body.summary).toBe("critical_failure");
    });

    it("reports postgres as unhealthy with an error message", async () => {
      const res = await request(app).get("/health/ready");
      expect(res.body.checks.postgres.status).toBe("unhealthy");
      expect(typeof res.body.checks.postgres.message).toBe("string");
    });
  });

  describe("when Redis is unhealthy", () => {
    beforeEach(() => {
      mockAllChecks({
        postgres: healthy(5),
        redis: unhealthy(0, "Redis client is not connected"),
        horizon: healthy(45),
        sorobanRpc: healthy(0),
        diskSpace: healthy(1),
      });
    });

    it("returns HTTP 503 with critical_failure", async () => {
      const res = await request(app).get("/health/ready");
      expect(res.status).toBe(503);
      expect(res.body.summary).toBe("critical_failure");
    });
  });

  describe("when Horizon is unreachable", () => {
    beforeEach(() => {
      mockAllChecks({
        postgres: healthy(5),
        redis: healthy(3),
        horizon: unhealthy(5000, "connect ECONNREFUSED 127.0.0.1:80"),
        sorobanRpc: healthy(0),
        diskSpace: healthy(1),
      });
    });

    it("returns HTTP 503 with critical_failure", async () => {
      const res = await request(app).get("/health/ready");
      expect(res.status).toBe(503);
      expect(res.body.summary).toBe("critical_failure");
      expect(res.body.checks.horizon.status).toBe("unhealthy");
    });
  });

  describe("when Soroban RPC is unreachable (non-critical)", () => {
    beforeEach(() => {
      mockAllChecks({
        postgres: healthy(5),
        redis: healthy(3),
        horizon: healthy(45),
        sorobanRpc: unhealthy(5001, "timed out after 5000 ms"),
        diskSpace: healthy(1),
      });
    });

    it("still returns HTTP 200 (ready) since Soroban RPC is non-critical", async () => {
      const res = await request(app).get("/health/ready");
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("ready");
      expect(res.body.summary).toBe("degraded");
      expect(res.body.checks.soroban_rpc.status).toBe("unhealthy");
    });
  });

  describe("when the process is shutting down", () => {
    beforeEach(() => {
      shutdownState.markShuttingDown();
    });

    it("returns HTTP 503 with not_ready and critical_failure without running checks", async () => {
      const res = await request(app).get("/health/ready");

      expect(res.status).toBe(503);
      expect(res.body.status).toBe("not_ready");
      expect(res.body.summary).toBe("critical_failure");
      expect(healthService.checkPostgres).not.toHaveBeenCalled();
    });
  });

  describe("when a check rejects unexpectedly", () => {
    beforeEach(() => {
      healthService.checkPostgres.mockRejectedValue(new Error("unexpected internal error"));
      healthService.checkRedis.mockResolvedValue(healthy());
      healthService.checkHorizon.mockResolvedValue(healthy());
      healthService.checkSorobanRpc.mockResolvedValue(healthy());
      healthService.checkDiskSpace.mockResolvedValue(healthy());
    });

    it("returns HTTP 500", async () => {
      const res = await request(app).get("/health/ready");
      expect(res.status).toBe(500);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("GET /health/started — startup probe", () => {
  it("returns HTTP 200 with status started once initialisation is complete", async () => {
    healthService.checkStartupComplete.mockResolvedValue({
      started: true,
      checks: { migrations: true, executor: true, indexer: true },
    });

    const res = await request(app).get("/health/started");

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("started");
    expect(typeof res.body.initDuration).toBe("number");
    expect(res.body.initDuration).toBeGreaterThanOrEqual(0);
    expect(res.body.checks).toEqual({
      migrations: true,
      executor: true,
      indexer: true,
    });
  });

  it("returns HTTP 503 with status starting while initialisation is incomplete", async () => {
    healthService.checkStartupComplete.mockResolvedValue({
      started: false,
      checks: { migrations: false, executor: true, indexer: true },
    });

    const res = await request(app).get("/health/started");

    expect(res.status).toBe(503);
    expect(res.body.status).toBe("starting");
    expect(res.body.checks.migrations).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("GET /health/dependencies — dependency status page", () => {
  it("returns detailed status with latency and a checkedAt timestamp for every dependency", async () => {
    healthService.runAllChecks.mockResolvedValue({
      postgres: healthy(5, "PostgreSQL is reachable"),
      redis: healthy(3, "Redis is reachable"),
      horizon: healthy(45, "Horizon is reachable"),
      soroban_rpc: healthy(0, "SOROBAN_RPC_URL not configured; check skipped"),
      disk_space: healthy(1, "Disk usage 40.0% at /"),
      memory_usage: healthy(0, "Process RSS 120.0 MB"),
      event_loop: healthy(2, "Event loop lag 2 ms"),
    });

    const res = await request(app).get("/health/dependencies");

    expect(res.status).toBe(200);
    const { dependencies } = res.body;
    expect(Object.keys(dependencies)).toEqual(
      expect.arrayContaining([
        "postgres",
        "redis",
        "horizon",
        "soroban_rpc",
        "disk_space",
        "memory_usage",
        "event_loop",
      ]),
    );
    for (const dep of Object.values(dependencies)) {
      expect(typeof dep.status).toBe("string");
      expect(typeof dep.latency).toBe("number");
      expect(typeof dep.checkedAt).toBe("string");
      expect(dep.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    }
  });
});

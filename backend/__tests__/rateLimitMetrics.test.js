/**
 * __tests__/rateLimitMetrics.test.js
 * Rate-limit observability unit and route tests (#238).
 */

"use strict";

const crypto = require("crypto");
const express = require("express");
const jwt = require("jsonwebtoken");
const request = require("supertest");

const ORIGINAL_HASH_SALT = process.env.RATE_LIMIT_IP_HASH_SALT;
const ORIGINAL_ADMIN_PUBLIC_KEYS = process.env.ADMIN_PUBLIC_KEYS;
process.env.RATE_LIMIT_IP_HASH_SALT = "rate-limit-metrics-test-salt";

const { formatErrorResponse } = require("../../shared/errorCodes");
const metrics = require("../src/services/metricsService");
const {
  getRateLimitStats,
  hashIp,
  normaliseRateLimitRoute,
  recordRateLimitAllowed,
  recordRateLimitBreach,
  resetRateLimitStats,
} = require("../src/middleware/rateLimitMetrics");
const { createInstrumentedLimiter } = require("../src/middleware/rateLimit");

const METRIC_NAMES = [
  "rate_limit_hits_total",
  "rate_limit_breaches_total",
  "rate_limit_bypassed_total",
];

function makeRequest({
  ip = "203.0.113.10",
  method = "GET",
  baseUrl = "/api/payments",
  route = "/:publicKey",
} = {}) {
  return {
    ip,
    method,
    baseUrl,
    route: { path: route },
  };
}

function resetPrometheusCounters() {
  for (const name of METRIC_NAMES) {
    metrics.register.getSingleMetric(name)?.reset();
  }
}

async function getMetricValue(name, labels) {
  const metric = metrics.register.getSingleMetric(name);
  expect(metric).toBeDefined();

  const snapshot = await metric.get();
  const sample = snapshot.values.find((value) =>
    Object.entries(labels).every(
      ([labelName, expected]) => value.labels[labelName] === expected,
    ),
  );

  return sample?.value ?? 0;
}

beforeEach(() => {
  resetRateLimitStats();
  resetPrometheusCounters();
});

afterAll(() => {
  resetRateLimitStats();
  resetPrometheusCounters();

  if (ORIGINAL_HASH_SALT === undefined) {
    delete process.env.RATE_LIMIT_IP_HASH_SALT;
  } else {
    process.env.RATE_LIMIT_IP_HASH_SALT = ORIGINAL_HASH_SALT;
  }
});

describe("rate-limit metric recording", () => {
  it("normalises mounted Express routes without exposing dynamic values", () => {
    const req = makeRequest({
      method: "POST",
      baseUrl: "/api/payments",
      route: "/:publicKey",
    });

    expect(normaliseRateLimitRoute(req)).toBe("POST /api/payments/:publicKey");
  });

  it("normalises dynamic values before a global limiter resolves a route", () => {
    const publicKey = `G${"C".repeat(55)}`;
    const req = {
      method: "GET",
      path: `/api/accounts/${publicKey}/payments/12345`,
    };

    expect(normaliseRateLimitRoute(req)).toBe("GET /api/accounts/*");
    expect(normaliseRateLimitRoute(req)).not.toContain(publicKey);
  });

  it("records allowed hits and bypasses in Prometheus and route stats", async () => {
    const req = makeRequest();

    recordRateLimitAllowed(req, "strict");

    const route = "GET /api/payments/:publicKey";
    await expect(
      getMetricValue("rate_limit_hits_total", {
        route,
        limiter_type: "strict",
        status: "allowed",
      }),
    ).resolves.toBe(1);
    await expect(
      getMetricValue("rate_limit_bypassed_total", {
        route,
        limiter_type: "strict",
      }),
    ).resolves.toBe(1);

    const stats = getRateLimitStats();
    expect(stats.perRouteHitRates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          route,
          limiterType: "strict",
          allowed: 1,
          blocked: 0,
          total: 1,
        }),
      ]),
    );
  });

  it("uses a stable HMAC-SHA256 IP hash and never exposes the raw IP", async () => {
    const rawIp = "198.51.100.42";
    const expectedHash = crypto
      .createHmac("sha256", process.env.RATE_LIMIT_IP_HASH_SALT)
      .update(rawIp)
      .digest("hex");

    expect(hashIp(rawIp)).toBe(expectedHash);
    expect(hashIp(rawIp)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashIp(rawIp)).not.toBe(hashIp("198.51.100.43"));

    recordRateLimitBreach(makeRequest({ ip: rawIp }), "sensitive");
    const serializedStats = JSON.stringify(getRateLimitStats());
    const metricsBody = await metrics.getMetrics();

    expect(serializedStats).not.toContain(rawIp);
    expect(serializedStats).toContain(expectedHash);
    expect(metricsBody).not.toContain(rawIp);
    expect(metricsBody).toContain(expectedHash);
  });
});

describe("instrumented express-rate-limit behavior", () => {
  it("keeps the existing 429 body and records blocked hits and breaches", async () => {
    const app = express();
    const message = formatErrorResponse("RATE_LIMITED_SENSITIVE");
    const limiter = createInstrumentedLimiter(
      {
        windowMs: 60_000,
        limit: 1,
        standardHeaders: true,
        legacyHeaders: false,
        message,
      },
      "test",
    );

    app.get("/limited", limiter, (_req, res) => res.json({ success: true }));

    const allowed = await request(app).get("/limited");
    const blocked = await request(app).get("/limited");

    expect(allowed.status).toBe(200);
    expect(blocked.status).toBe(429);
    expect(blocked.body).toEqual(message);

    await expect(
      getMetricValue("rate_limit_hits_total", {
        route: "GET /limited",
        limiter_type: "test",
        status: "blocked",
      }),
    ).resolves.toBe(1);
    const stats = getRateLimitStats();
    expect(stats.breachHistory).toHaveLength(1);
    expect(stats.breachHistory[0]).toEqual(
      expect.objectContaining({
        route: "GET /limited",
        limiterType: "test",
        ipHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    await expect(
      getMetricValue("rate_limit_breaches_total", {
        route: "GET /limited",
        ip: stats.breachHistory[0].ipHash,
      }),
    ).resolves.toBe(1);
  });

  it("preserves a limiter's configured custom handler", async () => {
    const app = express();
    const handler = jest.fn((_req, res) =>
      res.status(418).json({ error: "custom-limit-response" }),
    );
    const limiter = createInstrumentedLimiter(
      {
        windowMs: 60_000,
        limit: 1,
        handler,
      },
      "custom",
    );

    app.get("/custom", limiter, (_req, res) => res.sendStatus(204));

    await request(app).get("/custom");
    const blocked = await request(app).get("/custom");

    expect(blocked.status).toBe(418);
    expect(blocked.body).toEqual({ error: "custom-limit-response" });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(getRateLimitStats().breachHistory).toHaveLength(1);
  });
});

describe("rolling rate-limit statistics", () => {
  it("returns only the top 10 hashes in descending order and prunes old breaches", () => {
    const now = Date.parse("2026-07-24T12:00:00.000Z");
    const oldIp = "192.0.2.250";

    recordRateLimitBreach(
      makeRequest({ ip: oldIp }),
      "strict",
      now - 24 * 60 * 60 * 1000 - 1,
    );

    for (let index = 0; index < 12; index += 1) {
      const ip = `198.51.100.${index + 1}`;
      for (let count = 0; count <= index; count += 1) {
        recordRateLimitBreach(
          makeRequest({ ip }),
          "strict",
          now - index * 1_000,
        );
      }
    }

    const stats = getRateLimitStats(now);
    const breachCounts = stats.topLimitedIps.map((entry) => entry.breaches);

    expect(stats.topLimitedIps).toHaveLength(10);
    expect(breachCounts).toEqual([...breachCounts].sort((a, b) => b - a));
    expect(stats.topLimitedIps[0]).toEqual(
      expect.objectContaining({
        ipHash: hashIp("198.51.100.12"),
        breaches: 12,
      }),
    );
    expect(stats.breachHistory).toHaveLength(78);
    expect(stats.breachHistory).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ipHash: hashIp(oldIp) }),
      ]),
    );
  });
});

describe("GET /api/admin/rate-limit-stats", () => {
  const TEST_PUBLIC_KEY = `G${"B".repeat(55)}`;
  const NON_ADMIN_PUBLIC_KEY = `G${"A".repeat(55)}`;

  beforeAll(() => {
    process.env.ADMIN_PUBLIC_KEYS = TEST_PUBLIC_KEY;
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
    const statsRouter = require("../src/routes/rateLimitStats");
    app.use("/api/admin/rate-limit-stats", statsRouter);
    return app;
  }

  it("rejects requests without a JWT", async () => {
    const response = await request(createApp()).get(
      "/api/admin/rate-limit-stats",
    );

    expect(response.status).toBe(401);
    expect(response.body.error?.code).toBe("AUTH_MISSING_HEADER");
  });

  it("rejects an authenticated account outside the admin allowlist", async () => {
    const { JWT_SECRET } = require("../src/middleware/auth");
    const token = jwt.sign({ publicKey: NON_ADMIN_PUBLIC_KEY }, JWT_SECRET, {
      expiresIn: "5m",
    });

    const response = await request(createApp())
      .get("/api/admin/rate-limit-stats")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(403);
    expect(response.body.error?.code).toBe("AUTH_FORBIDDEN");
  });

  it("returns the statistics payload to an allowlisted admin", async () => {
    recordRateLimitBreach(makeRequest(), "strict");
    const { JWT_SECRET } = require("../src/middleware/auth");
    const token = jwt.sign({ publicKey: TEST_PUBLIC_KEY }, JWT_SECRET, {
      expiresIn: "5m",
    });

    const response = await request(createApp())
      .get("/api/admin/rate-limit-stats")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toEqual(
      expect.objectContaining({
        topLimitedIps: expect.any(Array),
        perRouteHitRates: expect.any(Array),
        breachHistory: expect.any(Array),
      }),
    );
    expect(response.body.data.topLimitedIps[0]).toEqual(
      expect.objectContaining({
        ipHash: hashIp("203.0.113.10"),
        breaches: 1,
      }),
    );
  });
});

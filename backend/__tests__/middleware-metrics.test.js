/* eslint-env jest */
"use strict";

const express = require("express");
const request = require("supertest");
const { trackHttpMetrics, normalisedRoute } = require("../src/middleware/metrics");
const metrics = require("../src/services/metricsService");

function makeRequest({ method = "GET", baseUrl = "", path = "/" } = {}) {
  return {
    method,
    baseUrl,
    path,
    route: { path },
  };
}

function resetMetrics() {
  metrics.register.getSingleMetric("finchippay_http_requests_total")?.reset();
  metrics.register.getSingleMetric("finchippay_http_request_duration_seconds")?.reset();
  metrics.register.getSingleMetric("finchippay_http_requests_in_flight")?.reset();
}

async function getGaugeValue(name) {
  const metric = metrics.register.getSingleMetric(name);
  if (!metric) return 0;
  const snap = await metric.get();
  if (snap.values) return snap.values.reduce((s, v) => s + (v.value || 0), 0);
  return snap.value || 0;
}

beforeEach(() => {
  resetMetrics();
});

describe("normalisedRoute", () => {
  it("returns method + path from route", () => {
    const req = makeRequest({ method: "GET", path: "/" });
    expect(normalisedRoute(req)).toBe("GET /");
  });

  it("includes baseUrl when mounted on a sub-path", () => {
    const req = {
      method: "POST",
      baseUrl: "/api/payments",
      route: { path: "/:id" },
    };
    expect(normalisedRoute(req)).toBe("POST /api/payments/:id");
  });

  it("does not duplicate slash when baseUrl ends in / and path is /", () => {
    const req = {
      method: "GET",
      baseUrl: "/api/payments",
      route: { path: "/" },
    };
    expect(normalisedRoute(req)).toBe("GET /api/payments");
  });

  it("falls back to req.path when route.path is unavailable", () => {
    const req = { method: "DELETE", path: "/api/unknown" };
    expect(normalisedRoute(req)).toBe("DELETE /api/unknown");
  });
});

describe("trackHttpMetrics middleware", () => {
  it("records RED metrics after a request completes", async () => {
    const app = express();
    app.use(trackHttpMetrics);
    app.get("/test", (req, res) => res.send("ok"));

    await request(app).get("/test").expect(200);

    await expect(
      metrics.register.getSingleMetric("finchippay_http_requests_total").get(),
    ).resolves.toMatchObject({
      values: expect.arrayContaining([expect.objectContaining({ value: 1 })]),
    });
  });

  it("tracks in-flight gauge during request", async () => {
    const app = express();
    app.use(trackHttpMetrics);
    app.get("/inflight", (req, res) => {
      expect(metrics.httpRequestsInFlight).toBeDefined();
      res.send("ok");
    });

    await request(app).get("/inflight").expect(200);
    const inFlight = await getGaugeValue("finchippay_http_requests_in_flight");
    expect(inFlight).toBe(0);
  });

  it("excludes /metrics path from self-recording", async () => {
    const app = express();
    app.use(trackHttpMetrics);
    app.get("/metrics", (req, res) => res.send("metrics"));

    await request(app).get("/metrics").expect(200);

    const totalSnap = await metrics.register
      .getSingleMetric("finchippay_http_requests_total")
      .get();
    expect(totalSnap.values).toBeUndefined();
  });

  it("excludes /api/metrics path from self-recording", async () => {
    const app = express();
    app.use(trackHttpMetrics);
    app.get("/api/metrics", (req, res) => res.send("metrics"));

    await request(app).get("/api/metrics").expect(200);

    const totalSnap = await metrics.register
      .getSingleMetric("finchippay_http_requests_total")
      .get();
    expect(totalSnap.values).toBeUndefined();
  });

  it("records 404 responses", async () => {
    const app = express();
    app.use(trackHttpMetrics);
    await request(app).get("/nonexistent").expect(404);

    await expect(
      metrics.register.getSingleMetric("finchippay_http_requests_total").get(),
    ).resolves.toMatchObject({
      values: expect.arrayContaining([expect.objectContaining({ value: 1 })]),
    });
  });

  it("records error responses (5xx)", async () => {
    const app = express();
    app.use(trackHttpMetrics);
    app.get("/error", (req, res) => res.status(500).send("error"));

    await request(app).get("/error").expect(500);

    const totalSnap = await metrics.register
      .getSingleMetric("finchippay_http_requests_total")
      .get();
    expect(totalSnap.values).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          value: 1,
          labels: expect.objectContaining({ status_code: "500" }),
        }),
      ]),
    );
  });
});

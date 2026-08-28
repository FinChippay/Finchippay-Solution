/* eslint-env jest */
"use strict";

const metrics = require("../src/services/metricsService");

function resetCounters() {
  metrics.register.getSingleMetric("finchippay_http_requests_total")?.reset();
  metrics.register.getSingleMetric("finchippay_http_request_duration_seconds")?.reset();
  metrics.register.getSingleMetric("finchippay_http_requests_in_flight")?.reset();
  metrics.register.getSingleMetric("finchippay_db_query_duration_seconds")?.reset();
  metrics.register.getSingleMetric("finchippay_horizon_request_duration_seconds")?.reset();
  metrics.register.getSingleMetric("finchippay_horizon_requests_total")?.reset();
  metrics.register.getSingleMetric("finchippay_webhook_deliveries_total")?.reset();
  metrics.register.getSingleMetric("finchippay_contract_events_indexed_total")?.reset();
  metrics.register.getSingleMetric("finchippay_active_users")?.reset();
  metrics.register.getSingleMetric("finchippay_payments_volume_total")?.reset();
  metrics.register.getSingleMetric("finchippay_error_count_total")?.reset();
}

async function getMetricValue(name, labels) {
  const metric = metrics.register.getSingleMetric(name);
  expect(metric).toBeDefined();
  const snapshot = await metric.get();
  const matching = snapshot.values?.filter((v) =>
    Object.entries(labels).every(([k, expected]) => String(v.labels[k]) === String(expected)),
  );
  return matching ? matching.reduce((s, v) => s + (v.value || 0), 0) : 0;
}

beforeEach(() => {
  resetCounters();
});

describe("metricsService — http_requests_total", () => {
  it("increments after inc()", async () => {
    metrics.httpRequestsTotal.inc({ method: "GET", route: "/api/health", status_code: 200 });
    await expect(
      getMetricValue("finchippay_http_requests_total", {
        method: "GET",
        route: "/api/health",
        status_code: "200",
      }),
    ).resolves.toBe(1);
  });

  it("increments multiple labels independently", async () => {
    metrics.httpRequestsTotal.inc({ method: "GET", route: "/api/health", status_code: 200 });
    metrics.httpRequestsTotal.inc({ method: "POST", route: "/api/payments", status_code: 201 });
    await expect(
      getMetricValue("finchippay_http_requests_total", {
        method: "GET",
        route: "/api/health",
        status_code: "200",
      }),
    ).resolves.toBe(1);
    await expect(
      getMetricValue("finchippay_http_requests_total", {
        method: "POST",
        route: "/api/payments",
        status_code: "201",
      }),
    ).resolves.toBe(1);
  });
});

describe("metricsService — http_request_duration_seconds", () => {
  it("records duration in histogram", async () => {
    metrics.httpRequestDurationSeconds.observe(
      { method: "GET", route: "/api/health", status_code: 200 },
      0.05,
    );
    const snapshot = await metrics.register
      .getSingleMetric("finchippay_http_request_duration_seconds")
      .get();
    expect(snapshot.values.some((v) => v.metricName?.endsWith("_count") && v.value === 1)).toBe(
      true,
    );
  });
});

describe("metricsService — http_requests_in_flight", () => {
  it("inc and dec modify gauge", async () => {
    metrics.httpRequestsInFlight.inc({ method: "GET", route: "/api/health" });
    metrics.httpRequestsInFlight.inc({ method: "GET", route: "/api/health" });
    await expect(
      getMetricValue("finchippay_http_requests_in_flight", { method: "GET", route: "/api/health" }),
    ).resolves.toBe(2);
    metrics.httpRequestsInFlight.dec({ method: "GET", route: "/api/health" });
    await expect(
      getMetricValue("finchippay_http_requests_in_flight", { method: "GET", route: "/api/health" }),
    ).resolves.toBe(1);
  });
});

describe("metricsService — horizon metrics", () => {
  it("horizon_requests_total increments", async () => {
    metrics.horizonRequestsTotal.inc({ operation: "account", status: "success" });
    await expect(
      getMetricValue("finchippay_horizon_requests_total", {
        operation: "account",
        status: "success",
      }),
    ).resolves.toBe(1);
  });

  it("horizon_request_duration_seconds records duration", async () => {
    metrics.horizonRequestDurationSeconds.observe({ operation: "payments" }, 0.2);
    const snapshot = await metrics.register
      .getSingleMetric("finchippay_horizon_request_duration_seconds")
      .get();
    expect(snapshot.values.some((v) => v.metricName?.endsWith("_count") && v.value === 1)).toBe(
      true,
    );
  });
});

describe("metricsService — webhook deliveries", () => {
  it("increments webhook_deliveries_total by status", async () => {
    metrics.webhookDeliveriesTotal.inc({ status: "success" });
    metrics.webhookDeliveriesTotal.inc({ status: "failed" });
    await expect(
      getMetricValue("finchippay_webhook_deliveries_total", { status: "success" }),
    ).resolves.toBe(1);
    await expect(
      getMetricValue("finchippay_webhook_deliveries_total", { status: "failed" }),
    ).resolves.toBe(1);
  });
});

describe("metricsService — contract events", () => {
  it("increments contract_events_indexed_total by event_type", async () => {
    metrics.contractEventsIndexedTotal.inc({ event_type: "payment" });
    metrics.contractEventsIndexedTotal.inc({ event_type: "trustline" });
    await expect(
      getMetricValue("finchippay_contract_events_indexed_total", { event_type: "payment" }),
    ).resolves.toBe(1);
    await expect(
      getMetricValue("finchippay_contract_events_indexed_total", { event_type: "trustline" }),
    ).resolves.toBe(1);
  });
});

describe("metricsService — active_users gauge", () => {
  it("set and read gauge value", () => {
    metrics.activeUsers.set(42);
    expect(metrics.register.getSingleMetric("finchippay_active_users").get().value).toBe(42);
  });
});

describe("metricsService — payments_volume_total", () => {
  it("increments by asset", async () => {
    metrics.paymentsVolumeTotal.inc({ asset: "XLM" }, 1000);
    metrics.paymentsVolumeTotal.inc({ asset: "USDC" }, 500);
    await expect(
      getMetricValue("finchippay_payments_volume_total", { asset: "XLM" }),
    ).resolves.toBe(1000);
    await expect(
      getMetricValue("finchippay_payments_volume_total", { asset: "USDC" }),
    ).resolves.toBe(500);
  });
});

describe("metricsService — error_count_total", () => {
  it("increments by service and error_code", async () => {
    metrics.errorCountTotal.inc({ service: "horizon", error_code: "TIMEOUT" });
    await expect(
      getMetricValue("finchippay_error_count_total", { service: "horizon", error_code: "TIMEOUT" }),
    ).resolves.toBe(1);
  });
});

describe("metricsService — getMetrics returns Prometheus format", () => {
  it("returns a string with expected content type", async () => {
    metrics.httpRequestsTotal.inc({ method: "GET", route: "/test", status_code: 200 });
    const body = await metrics.getMetrics();
    expect(typeof body).toBe("string");
    expect(body).toContain("http_requests_total");
    expect(metrics.getContentType()).toContain("text/plain");
  });
});

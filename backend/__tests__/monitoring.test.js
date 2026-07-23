/**
 * __tests__/monitoring.test.js
 * #272 — the dashboard and alert rules only reference metrics the backend
 * actually exposes, and every alert points at a runbook section that exists.
 *
 * A panel querying a metric nobody emits renders "No data", and an alert on one
 * never fires. Neither failure is visible until an incident, so it is checked
 * here instead.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const metrics = require("../src/services/metricsService");

const DOCS = path.join(__dirname, "..", "..", "docs");

const dashboard = JSON.parse(
  fs.readFileSync(path.join(DOCS, "grafana-dashboard.json"), "utf8"),
);
const alerts = yaml.load(
  fs.readFileSync(path.join(DOCS, "prometheus-alerts.yml"), "utf8"),
);
const scrapeConfig = yaml.load(
  fs.readFileSync(path.join(DOCS, "prometheus.yml"), "utf8"),
);
const notifiers = yaml.load(
  fs.readFileSync(path.join(DOCS, "grafana-notifiers.yml"), "utf8"),
);
const runbook = fs.readFileSync(
  path.join(DOCS, "monitoring-runbook.md"),
  "utf8",
);

/** Metric names the backend registers, including default Node.js metrics. */
async function exposedMetricNames() {
  const text = await metrics.getMetrics();
  return new Set(
    text
      .split("\n")
      .filter((line) => line.startsWith("# TYPE "))
      .map((line) => line.split(" ")[2]),
  );
}

/**
 * Whether a metric name is one the backend exposes, allowing for the histogram
 * suffixes Prometheus generates (_bucket, _sum, _count).
 */
function isExposed(name, exposed) {
  if (exposed.has(name)) return true;
  const base = name.replace(/_(bucket|sum|count)$/, "");
  return exposed.has(base);
}

/** Metric-looking identifiers in a PromQL expression. */
function metricsIn(expr) {
  const withoutFunctions = expr
    // Strip label matchers, which contain quoted values that look like names.
    .replace(/\{[^}]*\}/g, "")
    // Strip range selectors and durations.
    .replace(/\[[^\]]*\]/g, "");

  const PROMQL_KEYWORDS = new Set([
    "rate", "irate", "increase", "sum", "avg", "min", "max", "count", "by",
    "without", "on", "ignoring", "group_left", "group_right", "clamp_min",
    "clamp_max", "histogram_quantile", "topk", "bottomk", "label_replace",
    "abs", "ceil", "floor", "round", "delta", "idelta", "deriv", "predict_linear",
    "time", "vector", "scalar", "absent", "changes", "resets", "and", "or",
    "unless", "offset", "le", "quantile", "stddev", "stdvar", "up",
  ]);

  return [...withoutFunctions.matchAll(/\b([a-z_][a-z0-9_]*)\b/gi)]
    .map((m) => m[1])
    .filter((name) => !PROMQL_KEYWORDS.has(name))
    .filter((name) => name.includes("_"));
}

/** Every PromQL expression in the dashboard, with its panel title. */
function dashboardExpressions() {
  const found = [];
  for (const panel of dashboard.panels) {
    for (const target of panel.targets || []) {
      if (target.expr) found.push({ panel: panel.title, expr: target.expr });
    }
  }
  return found;
}

/** Every alert rule across all groups. */
function allRules() {
  return alerts.groups.flatMap((group) =>
    group.rules.map((rule) => ({ group: group.name, ...rule })),
  );
}

// ─── Metrics the backend exposes ──────────────────────────────────────────────

describe("metricsService", () => {
  it("registers the metrics the #272 panels depend on", async () => {
    const exposed = await exposedMetricNames();

    for (const name of [
      "http_requests_total",
      "http_request_duration_seconds",
      "rate_limit_hits_total",
      "webhook_deliveries_total",
      "webhook_delivery_duration_seconds",
      "contract_events_processed_total",
      "contract_event_indexer_lag_ledgers",
    ]) {
      expect(isExposed(name, exposed)).toBe(true);
    }
  });

  it("exports the counters the instrumented call sites use", () => {
    expect(typeof metrics.rateLimitHitsTotal.inc).toBe("function");
    expect(typeof metrics.webhookDeliveriesTotal.inc).toBe("function");
    expect(typeof metrics.webhookDeliveryDurationSeconds.startTimer).toBe(
      "function",
    );
    expect(typeof metrics.contractEventsProcessedTotal.inc).toBe("function");
    expect(typeof metrics.contractEventIndexerLagLedgers.set).toBe("function");
  });

  it("records the label values the dashboard queries group by", async () => {
    metrics.rateLimitHitsTotal.inc({ limiter: "global", route: "/api/test" });
    metrics.webhookDeliveriesTotal.inc({ outcome: "failed", status_code: "500" });
    metrics.contractEventsProcessedTotal.inc({ outcome: "parse_failed" });
    metrics.contractEventIndexerLagLedgers.set(42);

    const text = await metrics.getMetrics();
    expect(text).toContain('limiter="global"');
    expect(text).toContain('outcome="failed"');
    expect(text).toContain('outcome="parse_failed"');
    expect(text).toContain("contract_event_indexer_lag_ledgers 42");
  });
});

// ─── Dashboard ────────────────────────────────────────────────────────────────

describe("grafana-dashboard.json", () => {
  it("is valid JSON with a stable uid and a schema version Grafana accepts", () => {
    expect(dashboard.uid).toBe("finchippay-backend-metrics");
    expect(dashboard.schemaVersion).toBeGreaterThanOrEqual(36);
    expect(Array.isArray(dashboard.panels)).toBe(true);
  });

  it("adds the six panels required by #272", () => {
    const titles = dashboard.panels.map((p) => p.title);

    expect(titles).toEqual(
      expect.arrayContaining([
        "API Latency Distribution (heatmap)",
        "5xx Error Rate by Endpoint",
        "Rate Limit Hits Over Time",
        "Webhook Delivery Success Rate",
        "Contract Event Processing Lag",
        "Contract Events Processed",
      ]),
    );
  });

  it("gives every panel a unique id", () => {
    const ids = dashboard.panels.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("lays panels out without overlapping", () => {
    const occupied = new Set();

    for (const panel of dashboard.panels) {
      const { x, y, w, h } = panel.gridPos;
      for (let dx = 0; dx < w; dx += 1) {
        for (let dy = 0; dy < h; dy += 1) {
          const cell = `${x + dx},${y + dy}`;
          expect(occupied.has(cell)).toBe(false);
          occupied.add(cell);
        }
      }
      // Grafana's grid is 24 columns wide.
      expect(x + w).toBeLessThanOrEqual(24);
    }
  });

  it("points every panel at the provisioned Prometheus datasource", () => {
    for (const panel of dashboard.panels) {
      if (panel.type === "row") continue;
      expect(panel.datasource.uid).toBe("prometheus");
    }
  });

  it("only queries metrics the backend exposes", async () => {
    const exposed = await exposedMetricNames();
    const unknown = [];

    for (const { panel, expr } of dashboardExpressions()) {
      for (const name of metricsIn(expr)) {
        if (!isExposed(name, exposed)) unknown.push(`${panel}: ${name}`);
      }
    }

    expect(unknown).toEqual([]);
  });

  it("describes each new panel so an operator knows what it means", () => {
    const newPanels = dashboard.panels.filter(
      (p) => p.id >= 100 && p.type !== "row",
    );

    expect(newPanels.length).toBeGreaterThanOrEqual(6);
    for (const panel of newPanels) {
      expect(panel.description).toBeTruthy();
      expect(panel.description.length).toBeGreaterThan(40);
    }
  });
});

// ─── Alert rules ──────────────────────────────────────────────────────────────

describe("prometheus-alerts.yml", () => {
  const rules = allRules();

  it("defines the four alerts named in #272", () => {
    const names = rules.map((r) => r.alert);

    expect(names).toEqual(
      expect.arrayContaining([
        "HighErrorRate",
        "HighLatency",
        "WebhookDeliveryFailure",
        "RateLimitHigh",
      ]),
    );
  });

  it("also alerts on the contract event backlog from the problem statement", () => {
    const backlog = rules.find((r) => r.alert === "ContractEventBacklog");

    expect(backlog).toBeDefined();
    expect(backlog.expr).toContain("1000");
  });

  it("uses the thresholds and windows the issue specifies", () => {
    const byName = Object.fromEntries(rules.map((r) => [r.alert, r]));

    // 5xx > 5% for 5 min
    expect(byName.HighErrorRate.expr).toContain("0.05");
    expect(byName.HighErrorRate.for).toBe("5m");

    // p95 > 1000ms for 5 min
    expect(byName.HighLatency.expr).toContain("0.95");
    expect(byName.HighLatency.expr).toMatch(/>\s*1\b/);
    expect(byName.HighLatency.for).toBe("5m");

    // failure rate > 20% for 10 min
    expect(byName.WebhookDeliveryFailure.expr).toContain("0.2");
    expect(byName.WebhookDeliveryFailure.for).toBe("10m");

    // > 100 hits in 5 min
    expect(byName.RateLimitHigh.expr).toContain("increase");
    expect(byName.RateLimitHigh.expr).toContain("[5m]");
    expect(byName.RateLimitHigh.expr).toContain("100");
  });

  it("guards every ratio against a zero denominator", () => {
    // Without clamp_min a ratio over a silent period is NaN, and a rule
    // comparing NaN never fires — the alert would go quiet exactly when
    // traffic stops.
    for (const rule of rules) {
      if (!rule.expr.includes("/")) continue;
      expect(rule.expr).toContain("clamp_min");
    }
  });

  it("gives every rule a severity, a component, and a summary", () => {
    for (const rule of rules) {
      expect(["critical", "warning"]).toContain(rule.labels.severity);
      expect(rule.labels.component).toBeTruthy();
      expect(rule.annotations.summary).toBeTruthy();
      expect(rule.annotations.description).toBeTruthy();
    }
  });

  it("only alerts on metrics the backend exposes", async () => {
    const exposed = await exposedMetricNames();
    const unknown = [];

    for (const rule of rules) {
      for (const name of metricsIn(rule.expr)) {
        if (!isExposed(name, exposed)) unknown.push(`${rule.alert}: ${name}`);
      }
    }

    expect(unknown).toEqual([]);
  });

  it("links every rule to a runbook section that exists", () => {
    for (const rule of rules) {
      const runbookLink = rule.annotations.runbook;
      expect(runbookLink).toBeTruthy();

      const anchor = runbookLink.split("#")[1];
      expect(anchor).toBeTruthy();

      // Anchors are GitHub-style: lowercased heading text.
      const headings = [...runbook.matchAll(/^#{2,3} (.+)$/gm)].map((m) =>
        m[1].toLowerCase().replace(/[^a-z0-9]+/g, ""),
      );
      expect(headings).toContain(anchor.replace(/[^a-z0-9]+/g, ""));
    }
  });
});

// ─── Prometheus and Grafana configuration ─────────────────────────────────────

describe("prometheus.yml", () => {
  it("loads the alert rules", () => {
    expect(scrapeConfig.rule_files).toContain("/etc/prometheus/alerts.yml");
  });

  it("routes alerts to an Alertmanager", () => {
    expect(scrapeConfig.alerting.alertmanagers[0].static_configs[0].targets)
      .toContain("alertmanager:9093");
  });

  it("still scrapes the backend", () => {
    const job = scrapeConfig.scrape_configs.find(
      (j) => j.job_name === "finchippay-backend",
    );
    expect(job.metrics_path).toBe("/metrics");
  });
});

describe("grafana-notifiers.yml", () => {
  const names = notifiers.contactPoints.map((c) => c.name);

  it("configures both an email and a Slack contact point", () => {
    expect(names).toContain("finchippay-email");
    expect(names).toContain("finchippay-slack");

    const types = notifiers.contactPoints.flatMap((c) =>
      c.receivers.map((r) => r.type),
    );
    expect(types).toContain("email");
    expect(types).toContain("slack");
  });

  it("reads secrets from the environment rather than committing them", () => {
    const raw = fs.readFileSync(
      path.join(DOCS, "grafana-notifiers.yml"),
      "utf8",
    );

    expect(raw).toContain("${SLACK_WEBHOOK_URL}");
    expect(raw).toContain("${ALERT_EMAIL_TO}");
    // No real Slack webhook committed by accident.
    expect(raw).not.toMatch(/hooks\.slack\.com\/services\/T[A-Z0-9]{5,}/);
  });

  it("routes critical alerts to a contact point that exists", () => {
    const policy = notifiers.policies[0];
    expect(names).toContain(policy.receiver);

    const criticalRoute = policy.routes.find((r) =>
      r.object_matchers.some(
        ([label, , value]) => label === "severity" && value === "critical",
      ),
    );
    expect(criticalRoute).toBeDefined();
    expect(names).toContain(criticalRoute.receiver);
  });

  it("pages faster and repeats more often for critical alerts", () => {
    const policy = notifiers.policies[0];
    const critical = policy.routes[0];

    expect(critical.group_wait).toBe("10s");
    expect(policy.group_wait).toBe("30s");
  });
});

describe("monitoring-runbook.md", () => {
  it("documents a response procedure for every alert", () => {
    for (const rule of allRules()) {
      expect(runbook).toContain(rule.alert);
    }
  });

  it("documents every metric the backend exposes to the dashboard", () => {
    for (const name of [
      "rate_limit_hits_total",
      "webhook_deliveries_total",
      "contract_events_processed_total",
      "contract_event_indexer_lag_ledgers",
    ]) {
      expect(runbook).toContain(name);
    }
  });
});

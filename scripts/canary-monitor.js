#!/usr/bin/env node

/**
 * canary-monitor.js
 *
 * Runs during the canary release window and polls health endpoints,
 * Sentry API, and optional CloudWatch metrics to determine whether
 * the canary is healthy enough to promote.
 *
 * Emits one of three statuses:
 *   - healthy  → exit code 0 (promote)
 *   - degraded → exit code 1 (trigger rollback)
 *   - critical → exit code 2 (immediate rollback)
 *
 * Usage:
 *   node scripts/canary-monitor.js \
 *     --duration 5 \
 *     --health-url http://localhost:4000/health \
 *     --stage backend-10% \
 *     --threshold-error-rate 1 \
 *     --threshold-latency-multiplier 2 \
 *     --threshold-5xx-per-minute 5
 *
 * Environment variables:
 *   SENTRY_AUTH_TOKEN   — Sentry API token for error queries (optional)
 *   SENTRY_ORG          — Sentry organization slug
 *   SENTRY_PROJECT      — Sentry project slug
 *   CLOUDWATCH_NAMESPACE — CloudWatch namespace for latency metrics (optional)
 */

"use strict";

const https = require("https");
const http = require("http");

// ─── Configuration ──────────────────────────────────────────────────────────

const args = parseArgs(process.argv.slice(2));

const CONFIG = {
  durationMinutes: parseInt(args["duration"] || "5", 10),
  healthUrl: args["health-url"] || "http://localhost:4000/health",
  stage: args["stage"] || "canary",
  thresholds: {
    errorRatePercent: parseFloat(args["threshold-error-rate"] || "1"),
    latencyMultiplier: parseFloat(args["threshold-latency-multiplier"] || "2"),
    fivexxPerMinute: parseInt(args["threshold-5xx-per-minute"] || "5", 10),
  },
  pollIntervalMs: parseInt(args["poll-interval"] || "10000", 10), // 10s
};

const SENTRY_API_BASE = "https://sentry.io/api/0";
const METRICS_WINDOW_MS = 15 * 60 * 1000; // 15 minutes for baseline

// ─── Argument parser ────────────────────────────────────────────────────────

function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const value = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true";
      result[key] = value;
    }
  }
  return result;
}

// ─── HTTP helpers ───────────────────────────────────────────────────────────

function fetchJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https") ? https : http;
    const req = mod.get(url, {
      timeout: 10000,
      headers: {
        Accept: "application/json",
        ...(options.headers || {}),
      },
    }, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        if (res.statusCode >= 200 && res.statusCode < 400) {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode, body: data });
          }
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
        }
      });
    });
    req.on("timeout", () => { req.destroy(); reject(new Error("Request timed out")); });
    req.on("error", reject);
    req.end();
  });
}

// ─── Health endpoint check ──────────────────────────────────────────────────

async function checkHealthEndpoint(url) {
  const start = Date.now();
  try {
    const result = await fetchJson(url);
    const latencyMs = Date.now() - start;
    return {
      healthy: result.status < 500,
      statusCode: result.status,
      latencyMs,
      body: result.body,
    };
  } catch (err) {
    return {
      healthy: false,
      statusCode: 0,
      latencyMs: Date.now() - start,
      error: err.message,
    };
  }
}

// ─── Sentry error rate check ────────────────────────────────────────────────

async function getSentryErrorRate() {
  const org = process.env.SENTRY_ORG;
  const project = process.env.SENTRY_PROJECT;
  const token = process.env.SENTRY_AUTH_TOKEN;

  if (!org || !project || !token) {
    return { available: false, reason: "Sentry env vars not configured" };
  }

  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - 15 * 60; // 15 minutes

  try {
    // Query stats for the last 15 minutes
    const statsUrl = `${SENTRY_API_BASE}/projects/${org}/${project}/stats/?stat=received&resolution=1m&start=${windowStart}&end=${now}`;
    const stats = await fetchJson(statsUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const totalErrors = Array.isArray(stats.body)
      ? stats.body.reduce((sum, entry) => {
          if (Array.isArray(entry)) return sum + (entry[1] || 0);
          return sum;
        }, 0)
      : 0;

    const errorRatePerMinute = totalErrors / 15;

    // Also check for unresolved issues
    const issuesUrl = `${SENTRY_API_BASE}/projects/${org}/${project}/issues/?query=is:unresolved&limit=50`;
    const issues = await fetchJson(issuesUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const recentIssues = Array.isArray(issues.body)
      ? issues.body.filter((issue) => {
          const lastSeen = new Date(issue.lastSeen).getTime() / 1000;
          return lastSeen >= windowStart;
        }).length
      : 0;

    return {
      available: true,
      errorRatePerMinute,
      recentIssueCount: recentIssues,
    };
  } catch (err) {
    return {
      available: true,
      error: err.message,
      errorRatePerMinute: null,
    };
  }
}

// ─── 5xx rate check from health endpoint history ────────────────────────────

class MetricsCollector {
  constructor() {
    this.healthChecks = [];
    this.fivexxCount = 0;
    this.totalSamples = 0;
    this.firstCheckTime = Date.now();
  }

  recordHealthCheck(result) {
    const now = Date.now();
    this.healthChecks.push({ time: now, ...result });
    this.totalSamples++;

    if (result.statusCode >= 500) {
      this.fivexxCount++;
    }

    // Keep only last 30 minutes of data
    const cutoff = now - 30 * 60 * 1000;
    this.healthChecks = this.healthChecks.filter((h) => h.time >= cutoff);
  }

  getBaselineLatency() {
    // Use all healthy samples for a stable p50 baseline
    const samples = this.healthChecks.filter((h) => h.healthy);
    if (samples.length < 2) return null;
    const latencies = samples.map((s) => s.latencyMs).sort((a, b) => a - b);
    return latencies[Math.floor(latencies.length / 2)];
  }

  getRecentLatency() {
    // Use last 20 samples (or all if fewer) for a meaningful p95
    const window = 20;
    const samples = this.healthChecks.slice(-window);
    if (samples.length === 0) return null;
    const latencies = samples.map((s) => s.latencyMs).sort((a, b) => a - b);
    // p95: index at 95th percentile
    const p95Index = Math.max(0, Math.ceil(latencies.length * 0.95) - 1);
    return latencies[Math.min(p95Index, latencies.length - 1)];
  }

  getFivexxPerMinute() {
    const elapsedMinutes = (Date.now() - this.firstCheckTime) / 60000;
    if (elapsedMinutes < 0.5) return this.fivexxCount; // Not enough time yet
    return this.fivexxCount / Math.max(elapsedMinutes, 1);
  }

  getErrorRate() {
    if (this.totalSamples === 0) return 0;
    return (this.fivexxCount / this.totalSamples) * 100;
  }
}

// ─── Assessment ─────────────────────────────────────────────────────────────

function assessHealth(metrics, thresholds, startTime) {
  const issues = [];
  let status = "healthy";

  // Check error rate (from health endpoint)
  const errorRate = metrics.getErrorRate();
  if (errorRate > thresholds.errorRatePercent) {
    issues.push(`Error rate ${errorRate.toFixed(1)}% exceeds threshold ${thresholds.errorRatePercent}%`);
    status = "degraded";
  }

  // Check 5xx rate per minute
  const fivexxRate = metrics.getFivexxPerMinute();
  if (fivexxRate > thresholds.fivexxPerMinute) {
    issues.push(`5xx rate ${fivexxRate.toFixed(1)}/min exceeds threshold ${thresholds.fivexxPerMinute}/min`);
    status = "critical";
  }

  // Check latency
  const baseline = metrics.getBaselineLatency();
  const recent = metrics.getRecentLatency();
  if (baseline && recent) {
    if (recent > baseline * thresholds.latencyMultiplier) {
      issues.push(
        `p95 latency ${recent}ms is ${(recent / baseline).toFixed(1)}x baseline ${baseline}ms (threshold: ${thresholds.latencyMultiplier}x)`
      );
      if (status === "healthy") status = "degraded";
    }
  }

  // If health check consistently fails, it's critical
  const last5 = metrics.healthChecks.slice(-5);
  const consecutiveFailures = last5.filter((h) => !h.healthy).length;
  if (consecutiveFailures >= 3) {
    issues.push(`${consecutiveFailures} consecutive health check failures`);
    status = "critical";
  }

  const elapsedSeconds = ((Date.now() - startTime) / 1000).toFixed(0);
  return { status, issues, elapsedSeconds };
}

// ─── Main monitor loop ──────────────────────────────────────────────────────

async function runMonitor() {
  console.log(`[canary-monitor] Starting monitoring for stage: ${CONFIG.stage}`);
  console.log(`[canary-monitor] Duration: ${CONFIG.durationMinutes} minute(s)`);
  console.log(`[canary-monitor] Health URL: ${CONFIG.healthUrl}`);
  console.log(`[canary-monitor] Thresholds: error_rate>${CONFIG.thresholds.errorRatePercent}% | latency>${CONFIG.thresholds.latencyMultiplier}x | 5xx>${CONFIG.thresholds.fivexxPerMinute}/min`);
  console.log("");

  const metrics = new MetricsCollector();
  const startTime = Date.now();
  const endTime = startTime + CONFIG.durationMinutes * 60 * 1000;

  // Warmup: collect baseline
  console.log("[canary-monitor] Collecting baseline (30 seconds)...");
  for (let i = 0; i < 3; i++) {
    const result = await checkHealthEndpoint(CONFIG.healthUrl);
    metrics.recordHealthCheck(result);
    console.log(`  [baseline#${i + 1}] status=${result.statusCode} latency=${result.latencyMs}ms`);
    await sleep(10000);
  }

  const baseline = metrics.getBaselineLatency();
  console.log(`[canary-monitor] Baseline p50 latency: ${baseline || "N/A"}ms\n`);

  // Main monitoring loop
  let pollCount = 0;
  while (Date.now() < endTime) {
    pollCount++;
    const result = await checkHealthEndpoint(CONFIG.healthUrl);
    metrics.recordHealthCheck(result);

    const assessment = assessHealth(metrics, CONFIG.thresholds, startTime);
    const remaining = Math.max(0, Math.ceil((endTime - Date.now()) / 1000));

    console.log(
      `[poll#${pollCount}] status=${result.statusCode} latency=${result.latencyMs}ms ` +
      `5xx_rate=${metrics.getFivexxPerMinute().toFixed(1)}/min ` +
      `assessment=${assessment.status} remaining=${remaining}s`
    );

    if (assessment.issues.length > 0) {
      assessment.issues.forEach((issue) => console.log(`  ⚠  ${issue}`));
    }

    // Immediate critical → exit
    if (assessment.status === "critical") {
      const sentryData = await getSentryErrorRate();
      console.error(`\n[canary-monitor] CRITICAL: Immediate rollback required.`);
      if (sentryData.available && sentryData.errorRatePerMinute !== null) {
        console.error(`[canary-monitor] Sentry error rate: ${sentryData.errorRatePerMinute.toFixed(1)}/min`);
      }
      console.error(JSON.stringify({
        stage: CONFIG.stage,
        status: "critical",
        duration: assessment.elapsedSeconds,
        errorRate: metrics.getErrorRate().toFixed(2),
        fivexxPerMinute: metrics.getFivexxPerMinute().toFixed(2),
        baselineLatencyMs: baseline,
        recentP95LatencyMs: metrics.getRecentLatency(),
        totalSamples: metrics.totalSamples,
        issues: assessment.issues,
      }, null, 2));
      process.exit(2);
    }

    await sleep(CONFIG.pollIntervalMs);
  }

  // Final assessment
  const sentryData = await getSentryErrorRate();
  const finalAssessment = assessHealth(metrics, CONFIG.thresholds, startTime);

  console.log(`\n[canary-monitor] Monitoring complete for stage: ${CONFIG.stage}`);
  console.log(`[canary-monitor] Total polls: ${pollCount} | Duration: ${finalAssessment.elapsedSeconds}s`);
  console.log(`[canary-monitor] Error rate: ${metrics.getErrorRate().toFixed(2)}%`);
  console.log(`[canary-monitor] 5xx rate: ${metrics.getFivexxPerMinute().toFixed(2)}/min`);
  console.log(`[canary-monitor] Baseline latency: ${baseline}ms | Recent p95: ${metrics.getRecentLatency()}ms`);

  if (sentryData.available && sentryData.errorRatePerMinute !== null) {
    console.log(`[canary-monitor] Sentry error rate: ${sentryData.errorRatePerMinute.toFixed(1)}/min | Recent issues: ${sentryData.recentIssueCount}`);
  }

  if (finalAssessment.status === "healthy") {
    console.log(`\n[canary-monitor] ✅ HEALTHY — Recommend promotion.`);
    process.exit(0);
  } else if (finalAssessment.status === "degraded") {
    console.error(`\n[canary-monitor] ⚠️  DEGRADED — ${finalAssessment.issues.join("; ")}`);
    console.error(`[canary-monitor] Recommend rollback.`);
    process.exit(1);
  } else {
    console.error(`\n[canary-monitor] ❌ CRITICAL — ${finalAssessment.issues.join("; ")}`);
    process.exit(2);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Entry ───────────────────────────────────────────────────────────────────

if (require.main === module) {
  runMonitor().catch((err) => {
    console.error(`[canary-monitor] Fatal error: ${err.message}`);
    process.exit(2);
  });
}

module.exports = { checkHealthEndpoint, getSentryErrorRate, MetricsCollector, assessHealth };

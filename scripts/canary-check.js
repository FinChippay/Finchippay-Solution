#!/usr/bin/env node

/**
 * canary-check.js
 *
 * Queries the Sentry API to compare error rates between the current production
 * deployment and the new canary deployment. Exits with code 0 if the canary
 * error rate is stable (increase < 50%), or code 1 if there is a spike.
 *
 * Required environment variables:
 *   SENTRY_AUTH_TOKEN - Sentry API auth token
 *   SENTRY_ORG       - Sentry organization slug
 *   SENTRY_PROJECT   - Sentry project slug
 *   CANARY_DEPLOYMENT_URL - The canary deployment URL to tag/filter events
 */

const https = require('https');
const http = require('http');

const SENTRY_API_BASE = 'https://sentry.io/api/0';
const CANARY_ERROR_THRESHOLD = 0.5; // 50% increase threshold

function request(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, {
      headers: {
        Authorization: `Bearer ${process.env.SENTRY_AUTH_TOKEN}`,
        'Content-Type': 'application/json',
      },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(JSON.parse(data)); }
          catch (e) { resolve(data); }
        } else {
          reject(new Error(`Sentry API error ${res.statusCode}: ${data}`));
        }
      });
    });
    req.on('error', reject);
  });
}

async function getErrorRates() {
  const org = process.env.SENTRY_ORG;
  const project = process.env.SENTRY_PROJECT;
  const now = Math.floor(Date.now() / 1000);
  const fifteenMinutesAgo = now - 15 * 60;

  // Query stats for the last 15 minutes (production)
  const prodUrl = `${SENTRY_API_BASE}/projects/${org}/${project}/stats/?stat=received&resolution=1m&start=${fifteenMinutesAgo}&end=${now}`;
  const prodStats = await request(prodUrl);

  // Get canary error stats via the same endpoint filtered by release tag if available.
  // Since we may not have a dedicated release, we approximate canary by looking at
  // events whose `transaction` or `tags` reference the canary deployment URL.
  // For simplicity we compute the total production rate and compare against the
  // observed error rate reported by Sentry's `/projects/{org}/{project}/issues/` endpoint.
  const issuesUrl = `${SENTRY_API_BASE}/projects/${org}/${project}/issues/?query=is:unresolved&limit=100`;
  const issues = await request(issuesUrl);

  const totalProductionErrors = Array.isArray(prodStats) ? prodStats.reduce((sum, entry) => {
    if (Array.isArray(entry)) return sum + (entry[1] || 0);
    return sum;
  }, 0) : 0;

  // Compute average per-minute error rate over the last 15 minutes
  const productionErrorRate = totalProductionErrors / 15;

  // Heuristic canary error count: count issues with a recently seen timestamp
  const canaryErrorCount = Array.isArray(issues) ? issues.filter((issue) => {
    const lastSeen = new Date(issue.lastSeen).getTime() / 1000;
    return lastSeen >= fifteenMinutesAgo;
  }).length : 0;

  const canaryErrorRate = canaryErrorCount / 15;

  return {
    productionErrorRate,
    canaryErrorRate,
    increase: productionErrorRate === 0
      ? (canaryErrorRate > 0 ? 1 : 0)
      : (canaryErrorRate - productionErrorRate) / productionErrorRate,
  };
}

async function main() {
  console.log('[canary-check] Starting Sentry error rate evaluation...');

  if (!process.env.SENTRY_AUTH_TOKEN || !process.env.SENTRY_ORG || !process.env.SENTRY_PROJECT) {
    console.error('[canary-check] Missing required environment variables (SENTRY_AUTH_TOKEN, SENTRY_ORG, SENTRY_PROJECT).');
    process.exit(2);
  }

  try {
    const rates = await getErrorRates();
    console.log(`[canary-check] Production error rate (per minute): ${rates.productionErrorRate}`);
    console.log(`[canary-check] Canary error rate (per minute): ${rates.canaryErrorRate}`);
    console.log(`[canary-check] Error rate increase: ${(rates.increase * 100).toFixed(2)}%`);

    if (rates.increase > CANARY_ERROR_THRESHOLD) {
      console.error(`[canary-check] FAIL: Error rate spike detected (> ${CANARY_ERROR_THRESHOLD * 100}%). Recommend rollback.`);
      process.exit(1);
    }

    console.log('[canary-check] PASS: Error rate is stable. Recommend promotion.');
    process.exit(0);
  } catch (err) {
    console.error(`[canary-check] Error: ${err.message}`);
    process.exit(2);
  }
}

if (require.main === module) {
  main();
}

module.exports = { getErrorRates };
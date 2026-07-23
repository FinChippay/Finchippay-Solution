#!/usr/bin/env node
/**
 * scripts/create-grantfox-labels.js
 *
 * Creates all missing labels on the FinChippay/Finchippay-Solution repo
 * that are referenced in GRANTFOX_ISSUES.md.
 */

const { execSync } = require("child_process");

const REPO = "FinChippay/Finchippay-Solution";

// All labels used across the 50 issues (deduplicated)
const LABELS = [
  "contract", "optimization", "soroban",
  "testing", "security",
  "indexer", "new-service",
  "feature", "vesting", "airdrop",
  "governance",
  "devops", "automation", "tooling",
  "database", "persistence", "high-priority",
  "auth", "sep-0010",
  "caching", "redis",
  "webhooks", "reliability",
  "rate-limiting",
  "turrets",
  "sep-24", "anchor", "fiat",
  "sep-12", "kyc", "compliance",
  "graphql", "api",
  "validation", "refactor",
  "scheduled", "cron",
  "observability", "tracing", "opentelemetry",
  "ui", "dark-mode",
  "accessibility", "a11y",
  "pwa", "offline",
  "wallet", "multi-account",
  "export", "csv",
  "analytics", "charts",
  "fees", "ux",
  "safety",
  "ledger", "hardware",
  "nft", "receipts",
  "notifications", "push",
  "mobile", "responsive",
  "internationalization", "i18n",
  "realtime", "sse",
  "contacts", "import-export",
  "tokens", "assets", "discovery",
  "rtl",
  "e2e", "playwright", "escrow", "multi-sig",
  "lighthouse",
  "bundle-size",
  "dependencies",
  "verification", "transparency",
  "load-test",
  "deployment", "vercel", "canary",
  "errors", "consistency",
  "feature-flags", "configuration",
  "sdk", "developer-experience",
  "logging",
  "cross-cutting"
];

const COLORS = [
  "0052cc", "d73a4a", "a2eeef", "7057ff", "008672",
  "e4e669", "d876e3", "ffffff", "0e8a16", "fbca04",
  "bfd4f2", "c5def5", "f24403", "5319e7", "b60205",
];

let created = 0;
let skipped = 0;
let failed = 0;

for (let i = 0; i < LABELS.length; i++) {
  const label = LABELS[i];
  const color = COLORS[i % COLORS.length];
  const desc = label.replace(/-/g, " ");

  try {
    // Check if label exists
    execSync(`gh label list --repo "${REPO}" --search "${label}" --json name`, {
      encoding: "utf-8",
      stdio: "pipe",
    });
    const result = execSync(
      `gh label list --repo "${REPO}" --search "${label}" --json name 2>&1`,
      { encoding: "utf-8" }
    );
    if (result.includes(`"name":"${label}"`)) {
      console.log(`⏭️  Label "${label}" already exists`);
      skipped++;
      continue;
    }
  } catch (_) {}

  try {
    execSync(
      `gh label create "${label}" --repo "${REPO}" --color "${color}" --description "${desc}"`,
      { encoding: "utf-8", stdio: "pipe" }
    );
    console.log(`✅ Created label: "${label}"`);
    created++;
  } catch (err) {
    // Label might already exist
    if (err.stderr && err.stderr.includes("already_exists")) {
      console.log(`⏭️  Label "${label}" already exists`);
      skipped++;
    } else {
      console.error(`❌ Failed to create "${label}": ${err.stderr || err.message}`);
      failed++;
    }
  }
}

console.log(`\nSummary: ${created} created, ${skipped} already existed, ${failed} failed`);

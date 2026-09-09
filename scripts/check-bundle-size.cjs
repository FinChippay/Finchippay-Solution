#!/usr/bin/env node
/**
 * Fails CI if the compiled frontend JS bundle exceeds the budget.
 *
 * Usage: node scripts/check-bundle-size.js [budgetMB]
 * Default budget: 7 MB of raw JS across all .next/static chunks.
 */
const fs = require("fs");
const path = require("path");

const BUDGET_BYTES = Number(process.argv[2] || 7) * 1024 * 1024;
const staticDir = path.join(__dirname, "..", "frontend", ".next", "static");

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name.endsWith(".js")) out.push(full);
  }
  return out;
}

if (!fs.existsSync(staticDir)) {
  console.error(`No static output at ${staticDir} — run the frontend build first.`);
  process.exit(1);
}

const files = walk(staticDir);
const totalBytes = files.reduce((sum, f) => sum + fs.statSync(f).size, 0);
const largest = files
  .map((f) => ({ name: path.relative(staticDir, f), size: fs.statSync(f).size }))
  .sort((a, b) => b.size - a.size)
  .slice(0, 5);

console.log(
  `Bundle size: ${(totalBytes / 1024 / 1024).toFixed(2)} MB across ${files.length} JS chunks`,
);
for (const f of largest) {
  console.log(`  ${(f.size / 1024).toFixed(1)} KB  ${f.name}`);
}

if (totalBytes > BUDGET_BYTES) {
  console.error(`❌ Bundle exceeds the ${BUDGET_BYTES / 1024 / 1024} MB budget.`);
  process.exit(1);
}
console.log(`✅ Within the ${BUDGET_BYTES / 1024 / 1024} MB budget.`);
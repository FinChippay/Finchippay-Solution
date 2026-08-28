#!/usr/bin/env node
/**
 * scripts/add-labels-to-issues.js
 *
 * Re-applies the mandatory FWC26 campaign labels plus each issue's domain
 * labels (parsed from the `**Labels:**` line in GRANTFOX_ISSUES.md) to the
 * already-created GitHub issues. Matches issues by their `Issue #N — Title`
 * title, so GitHub issue numbers do not need to be known up front.
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const REPO = "FinChippay/Finchippay-Solution";
const ISSUES_FILE = path.join(__dirname, "..", "GRANTFOX_ISSUES.md");
const DRY_RUN = process.argv.includes("--dry-run");

const CAMPAIGN_LABELS = [
  "GrantFox OSS",
  "Maybe Rewarded",
  "Official Campaign | FWC26",
];

function parseIssues(content) {
  const issues = [];
  const parts = content.split(/^### Issue #(\d+)/gm);
  for (let i = 1; i < parts.length; i += 2) {
    const num = parseInt(parts[i], 10);
    const rawBody = (parts[i + 1] || "").trim();
    const titleMatch = rawBody.match(/^— (.+)/m);
    const title = titleMatch ? titleMatch[1].trim() : `Issue #${num}`;
    const labelMatch = rawBody.match(/^\*\*Labels:\*\* (.+)$/m);
    const labels = labelMatch
      ? [...labelMatch[1].matchAll(/`([^`]+)`/g)].map((m) => m[1])
      : [];
    issues.push({ num, title, labels });
  }
  return issues;
}

function ghJson(cmd) {
  const out = execSync(cmd, { encoding: "utf-8", stdio: "pipe" }).trim();
  return out ? JSON.parse(out) : [];
}

function main() {
  const content = fs.readFileSync(ISSUES_FILE, "utf-8");
  const issues = parseIssues(content);
  const openIssues = ghJson(
    `gh issue list --repo "${REPO}" --state open --limit 300 --json number,title`
  );

  let ok = 0;
  let skipped = 0;
  let fail = 0;

  for (const issue of issues) {
    const expectedTitle = `Issue #${issue.num} — ${issue.title}`;
    const ghIssue = openIssues.find((o) => o.title === expectedTitle);
    if (!ghIssue) {
      console.log(`⏭️  #${issue.num} not found on GitHub ("${expectedTitle}")`);
      skipped++;
      continue;
    }

    const labels = [...new Set([...CAMPAIGN_LABELS, ...issue.labels])];
    const labelStr = labels.join(",");
    if (DRY_RUN) {
      console.log(`[DRY] #${ghIssue.number}: +${labels.join(", ")}`);
      ok++;
      continue;
    }
    try {
      execSync(
        `gh issue edit ${ghIssue.number} --repo "${REPO}" --add-label "${labelStr}"`,
        { encoding: "utf-8", stdio: "pipe", timeout: 15000 }
      );
      console.log(`OK #${ghIssue.number}: +${labels.join(", ")}`);
      ok++;
    } catch (err) {
      console.error(`FAIL #${ghIssue.number}: ${(err.stderr || err.message).slice(0, 120)}`);
      fail++;
    }
  }

  console.log(`\nDone: ${ok} labeled, ${skipped} not found, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

main();

#!/usr/bin/env node
/**
 * scripts/create-grantfox-issues.js
 *
 * Parses GRANTFOX_ISSUES.md and creates GitHub issues via `gh issue create`.
 * Each issue's `**Labels:**` line is applied as real GitHub labels, plus the
 * mandatory FWC26 campaign labels so the issues appear inside the active
 * campaign on GrantFox.
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const fileArg = process.argv.find((a) => a.startsWith("--file="));
const ISSUES_FILE = fileArg
  ? path.resolve(fileArg.split("=")[1])
  : path.join(__dirname, "..", "GRANTFOX_ISSUES.md");
const REPO = "FinChippay/Finchippay-Solution";
const DRY_RUN = process.argv.includes("--dry-run");
const startArg = process.argv.find((a) => a.startsWith("--start="));
const START_INDEX = startArg ? parseInt(startArg.split("=")[1], 10) : 1;

// Mandatory campaign labels. These must match the active GrantFox campaign
// tag EXACTLY — a mismatched label means the issue will not appear in the
// campaign inside GrantFox.
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
    let body = rawBody.replace(/^— .+\n/, "").trim();

    // Extract backtick-wrapped labels from the `**Labels:**` line.
    const labelMatch = body.match(/^\*\*Labels:\*\* (.+)$/m);
    const labels = labelMatch
      ? [...labelMatch[1].matchAll(/`([^`]+)`/g)].map((m) => m[1])
      : [];

    // Drop the Labels line from the body (labels become real GitHub labels).
    body = body.replace(/^\*\*Labels:\*\* .+\n?/m, "").trim();

    issues.push({ num, title, body, labels });
  }
  return issues;
}

function createIssue(issue) {
  const { num, title, body, labels } = issue;
  const fullTitle = `Issue #${num} — ${title}`;

  const allLabels = [...new Set([...CAMPAIGN_LABELS, ...labels])];

  const tmpFile = `/tmp/gh-issue-${num}.md`;
  fs.writeFileSync(tmpFile, body, "utf-8");

  if (DRY_RUN) {
    console.log(`[DRY] #${num}: ${fullTitle}`);
    console.log(`      labels: ${allLabels.join(", ")}`);
    return { num, success: true, url: "(dry-run)" };
  }

  try {
    const labelArg = allLabels.join(",");
    // Escape characters that the shell would otherwise interpret inside the
    // quoted --title argument (backticks, $, backslash, double quotes).
    const safeTitle = fullTitle.replace(/[\\"`$]/g, (ch) => "\\" + ch);
    const result = execSync(
      `gh issue create --repo "${REPO}" --title "${safeTitle}" --body-file "${tmpFile}" --label "${labelArg}"`,
      { encoding: "utf-8", timeout: 15000 }
    );
    const url = result.trim();
    console.log(`OK #${num}: ${url} [${allLabels.length} labels]`);
    try { fs.unlinkSync(tmpFile); } catch (_) {}
    return { num, success: true, url };
  } catch (err) {
    console.error(`FAIL #${num}: ${(err.stderr || err.message).slice(0, 160)}`);
    try { fs.unlinkSync(tmpFile); } catch (_) {}
    return { num, success: false, error: (err.stderr || err.message).trim() };
  }
}

console.log(`${DRY_RUN ? "[DRY RUN] " : ""}Reading ${ISSUES_FILE}...`);
const content = fs.readFileSync(ISSUES_FILE, "utf-8");
const allIssues = parseIssues(content);
console.log(`Found ${allIssues.length} issues. Starting from #${START_INDEX}.`);

const todo = allIssues.filter((i) => i.num >= START_INDEX);
if (todo.length === 0) { console.log("None to create."); process.exit(0); }

const results = [];
for (const issue of todo) {
  const r = createIssue(issue);
  results.push(r);
  if (!DRY_RUN) {
    // Small delay to avoid secondary rate limits.
    execSync("sleep 2", { stdio: "ignore" });
  }
}

const ok = results.filter((r) => r.success).length;
const bad = results.filter((r) => !r.success).length;
console.log(`\nDone: ${ok} created, ${bad} failed`);
if (bad > 0) {
  const firstFail = results.find((r) => !r.success);
  console.log(`First failure: #${firstFail.num}`);
  console.log(`Re-run: node scripts/create-grantfox-issues.js --start=${firstFail.num}`);
}
process.exit(bad > 0 ? 1 : 0);

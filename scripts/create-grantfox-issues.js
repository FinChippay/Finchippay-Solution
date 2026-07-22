#!/usr/bin/env node
/**
 * scripts/create-grantfox-issues.js
 * Parses GRANTFOX_ISSUES.md and creates GitHub issues via `gh issue create`.
 * Uses only existing labels: "GrantFox OSS" + "Maybe Rewarded".
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ISSUES_FILE = path.join(__dirname, "..", "GRANTFOX_ISSUES.md");
const REPO = "FinChippay/Finchippay-Solution";
const DRY_RUN = process.argv.includes("--dry-run");
const startArg = process.argv.find((a) => a.startsWith("--start="));
const START_INDEX = startArg ? parseInt(startArg.split("=")[1], 10) : 1;

// Use only labels that definitely exist on the repo
const LABELS = "GrantFox OSS,Maybe Rewarded";

function parseIssues(content) {
  const issues = [];
  const parts = content.split(/^### Issue #(\d+)/gm);
  for (let i = 1; i < parts.length; i += 2) {
    const num = parseInt(parts[i], 10);
    const rawBody = (parts[i + 1] || "").trim();
    const titleMatch = rawBody.match(/^— (.+)/m);
    const title = titleMatch ? titleMatch[1].trim() : `Issue #${num}`;
    let body = rawBody.replace(/^— .+\n/, "").trim();
    issues.push({ num, title, body });
  }
  return issues;
}

function createIssue(issue) {
  const { num, title, body } = issue;
  const fullTitle = `Issue #${num} — ${title}`;

  const tmpFile = `/tmp/gh-issue-${num}.md`;
  fs.writeFileSync(tmpFile, body, "utf-8");

  if (DRY_RUN) {
    console.log(`[DRY] #${num}: ${fullTitle}`);
    return { num, success: true, url: "(dry-run)" };
  }

  try {
    const result = execSync(
      `gh issue create --repo "${REPO}" --title "${fullTitle.replace(/"/g, '\\"')}" --body-file "${tmpFile}" --label "${LABELS}"`,
      { encoding: "utf-8", timeout: 15000 }
    );
    const url = result.trim();
    console.log(`OK #${num}: ${url}`);
    try { fs.unlinkSync(tmpFile); } catch (_) {}
    return { num, success: true, url };
  } catch (err) {
    console.error(`FAIL #${num}: ${(err.stderr || err.message).slice(0, 120)}`);
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
    // Small delay to avoid secondary rate limits
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

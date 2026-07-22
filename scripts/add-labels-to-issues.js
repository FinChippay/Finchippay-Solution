#!/usr/bin/env node
/**
 * Adds domain labels to all 50 GrantFox issues.
 * Labels are mapped by category.
 */
const { execSync } = require("child_process");
const REPO = "FinChippay/Finchippay-Solution";

const LABEL_MAP = {
  // Contract issues 1-8
  contract: [1,2,3,4,5,6,7,8],
  backend: [3,9,10,11,12,13,14,15,16,17,18,19,20],
  frontend: [21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38],
  testing: [2,39,40,45],
  security: [2,6,10,13,43],
  performance: [1,11,41,42],
  "good first issue": [1,22,26,36],
  "help wanted": [9,21,23,47],

  // Derive issue numbers from the GitHub sequence (starting at #123)
  // Issue #1 = GitHub #123, Issue #50 = GitHub #172
};

function ghNum(issueNum) { return 122 + issueNum; }

// Build reverse map: github_number -> [labels]
const revMap = {};
for (const [label, nums] of Object.entries(LABEL_MAP)) {
  for (const n of nums) {
    const gn = ghNum(n);
    if (!revMap[gn]) revMap[gn] = [];
    revMap[gn].push(label);
  }
}

// Add "GrantFox OSS" to any that don't have it (all should already)
for (let i = 1; i <= 50; i++) {
  const gn = ghNum(i);
  if (!revMap[gn]) revMap[gn] = [];
  if (!revMap[gn].includes("GrantFox OSS")) revMap[gn].push("GrantFox OSS");
}

console.log(`Adding labels to ${Object.keys(revMap).length} issues...\n`);

let ok = 0, fail = 0;

for (const [gn, labels] of Object.entries(revMap)) {
  const labelStr = labels.join(",");
  const cmd = `gh issue edit ${gn} --repo "${REPO}" --add-label "${labelStr}"`;
  try {
    execSync(cmd, { encoding: "utf-8", stdio: "pipe", timeout: 10000 });
    console.log(`OK #${gn}: +${labels.join(", ")}`);
    ok++;
  } catch (err) {
    console.error(`FAIL #${gn}: ${(err.stderr || err.message).slice(0, 100)}`);
    fail++;
  }
  execSync("sleep 0.8", { stdio: "ignore" });
}

console.log(`\nDone: ${ok} labeled, ${fail} failed`);

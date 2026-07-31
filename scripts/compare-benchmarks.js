#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

function compareBenchmarks({ baselinePath, currentPath, summaryPath, thresholdPct = 20 }) {
  const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
  const current = JSON.parse(fs.readFileSync(currentPath, "utf8"));
  const baselineMap = new Map(baseline.map((item) => [item.name, item.value]));
  const currentMap = new Map(current.map((item) => [item.name, item.value]));

  const results = [];
  const names = new Set([...baselineMap.keys(), ...currentMap.keys()]);

  for (const name of names) {
    const base = baselineMap.get(name);
    const cur = currentMap.get(name);
    if (base == null || cur == null) continue;
    const deltaPct = base === 0 ? 0 : Number((((cur - base) / base) * 100).toFixed(2));
    results.push({ name, base, current: cur, deltaPct });
  }

  const failed = results.some((item) => item.deltaPct > thresholdPct);

  let summary = ["# Benchmark comparison", "", "| Metric | Base | Current | Delta % |", "| --- | ---: | ---: | ---: |"];
  for (const item of results) {
    summary.push(`| ${item.name} | ${item.base} | ${item.current} | ${item.deltaPct}% |`);
  }
  summary.push("");
  summary.push(failed ? `Regressions detected above ${thresholdPct}% threshold.` : `No regressions detected.`);

  fs.mkdirSync(path.dirname(summaryPath), { recursive: true });
  fs.writeFileSync(summaryPath, summary.join("\n"));

  return { results, failed, summaryPath };
}

if (require.main === module) {
  const [, , baselinePath = "benchmarks/base.json", currentPath = "benchmarks/current.json", summaryPath = "benchmarks/summary.md", thresholdArg] = process.argv;
  const thresholdPct = thresholdArg ? Number(thresholdArg) : 20;
  const result = compareBenchmarks({ baselinePath, currentPath, summaryPath, thresholdPct });
  if (result.failed) {
    process.exit(1);
  }
}

module.exports = { compareBenchmarks };

const fs = require("fs");
const os = require("os");
const path = require("path");
const { compareBenchmarks } = require("../../../scripts/compare-benchmarks");

describe("compareBenchmarks", () => {
  it("flags regressions and writes a markdown summary", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "benchmarks-"));
    const baselinePath = path.join(dir, "baseline.json");
    const currentPath = path.join(dir, "current.json");
    const summaryPath = path.join(dir, "summary.md");

    fs.writeFileSync(
      baselinePath,
      JSON.stringify(
        [
          { name: "backend.health", value: 100 },
          { name: "frontend.render", value: 200 },
        ],
        null,
        2,
      ),
    );

    fs.writeFileSync(
      currentPath,
      JSON.stringify(
        [
          { name: "backend.health", value: 125 },
          { name: "frontend.render", value: 180 },
        ],
        null,
        2,
      ),
    );

    const result = compareBenchmarks({
      baselinePath,
      currentPath,
      summaryPath,
      thresholdPct: 20,
    });

    expect(result.failed).toBe(true);
    expect(result.results[0].deltaPct).toBe(25);
    expect(fs.existsSync(summaryPath)).toBe(true);
    const summary = fs.readFileSync(summaryPath, "utf8");
    expect(summary).toContain("backend.health");
  });
});

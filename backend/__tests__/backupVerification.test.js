/* eslint-env jest */
"use strict";

const path = require("path");
const fs = require("fs");
const os = require("os");

jest.mock("../src/services/backupService", () => ({
  BACKUP_DIR: "/unused-in-tests",
  listBackups: jest.fn(),
  performBackup: jest.fn(),
  restoreBackup: jest.fn(),
  applyRetention: jest.fn(),
  startScheduler: jest.fn(),
  getBackupStatus: jest.fn(),
}));

jest.mock("../src/services/metricsService", () => ({
  backupVerificationSuccess: { set: jest.fn() },
  backupVerificationDurationSeconds: { observe: jest.fn() },
}));

jest.mock("child_process", () => ({
  exec: jest.fn((cmd, cb) => cb(null, { stdout: "", stderr: "" })),
}));

jest.mock("node-cron", () => ({
  schedule: jest.fn(() => ({ stop: jest.fn() })),
}));

jest.mock("../src/db", () => jest.fn(() => ({ insert: jest.fn(async () => 1) })));

// The `knex` factory is evaluated lazily (per require), reading the current
// `mockTempKnex` at call time so each test can install its own fake.
let mockTempKnex;
jest.mock("knex", () => jest.fn(() => mockTempKnex));

const BACKUP_FILE = "backup-2026-08-22-020000.sql";
const backupDir = path.join(os.tmpdir(), `finchippay-verify-test-${process.pid}`);

/**
 * Build a fake temp-Knex whose query chains dispatch on the operations that
 * were invoked, mirroring the exact call shapes the service produces:
 *   - orphan checks: leftJoin → whereNotNull → whereNull → count
 *   - negative tips: whereNotNull → andWhere → count
 *   - missing address: whereNotNull → whereNull → count
 *   - row counts: count
 *   - scheduled amounts: select
 */
function createFakeTempKnex(config = {}) {
  const tables = config.tables || [];
  const rawTables = config.rawTables || [];
  const orphans = config.orphans || {};
  const orphanSamples = config.orphanSamples || {};
  const tipCounts = config.tipCounts || {};
  const scheduleAmounts = config.scheduleAmounts || [];
  const rowCounts = config.rowCounts || {};

  const methodsOf = (ops) => ops.map(([m]) => m);

  const makeChain = (table) => {
    const ops = [];
    const record =
      (name) =>
      (...args) => {
        ops.push([name, ...args]);
        return chain;
      };
    const chain = {
      count: record("count"),
      whereNotNull: record("whereNotNull"),
      whereNull: record("whereNull"),
      andWhere: record("andWhere"),
      leftJoin: record("leftJoin"),
      limit: record("limit"),
      select: (...args) => {
        ops.push(["select", ...args]);
        const methods = methodsOf(ops);
        if (methods.includes("leftJoin")) return orphanSamples[table] || [];
        if (table === "scheduled_transactions") return scheduleAmounts;
        return [];
      },
      first: async () => {
        const methods = methodsOf(ops);
        if (methods.includes("leftJoin")) return orphans[table] || { count: "0" };
        if (methods.includes("andWhere")) return tipCounts.nonPositive || { count: "0" };
        if (methods.includes("whereNull")) return tipCounts.missingAddress || { count: "0" };
        return rowCounts[table] || { count: "0" };
      },
    };
    return chain;
  };

  const tempKnex = jest.fn((table) => makeChain(table));
  tempKnex.schema = { hasTable: jest.fn(async (t) => tables.includes(t)) };
  tempKnex.raw = jest.fn(async () => rawTables);
  tempKnex.migrate = { latest: jest.fn(async () => [1, ["migration"]]) };
  tempKnex.destroy = jest.fn(async () => {});
  return tempKnex;
}

/** Reset the module registry and re-require everything so mock instances and
 *  the service under test come from the same generation. */
function loadService() {
  jest.resetModules();
  const svc = require("../src/services/backupVerificationService");
  return {
    svc,
    backupService: require("../src/services/backupService"),
    metrics: require("../src/services/metricsService"),
    exec: require("child_process").exec,
    cron: require("node-cron"),
    logger: require("../src/utils/logger"),
  };
}

function validConfig(overrides = {}) {
  return {
    tables: ["tips", "scheduled_transactions", "usernames"],
    rawTables: [
      { name: "tips" },
      { name: "scheduled_transactions" },
      { name: "usernames" },
      { name: "knex_migrations" },
    ],
    orphans: {},
    orphanSamples: {},
    tipCounts: { nonPositive: { count: "0" }, missingAddress: { count: "0" } },
    scheduleAmounts: [
      { id: "s1", amount: "10" },
      { id: "s2", amount: "5.5" },
    ],
    rowCounts: {
      tips: { count: "12" },
      scheduled_transactions: { count: "2" },
      usernames: { count: "5" },
      knex_migrations: { count: "27" },
    },
    ...overrides,
  };
}

beforeEach(() => {
  fs.mkdirSync(backupDir, { recursive: true });
  fs.writeFileSync(path.join(backupDir, BACKUP_FILE), "PRAGMA foreign_keys=OFF;\n");
  process.env.BACKUP_DIR = backupDir;
  delete process.env.DB_PROVIDER;
  delete process.env.BACKUP_VERIFY_SCHEDULE;
  delete process.env.BACKUP_VERIFY_ENABLED;
});

afterAll(() => {
  fs.rmSync(backupDir, { recursive: true, force: true });
});

describe("backupVerificationService.verifyLatestBackup", () => {
  it("restores the latest backup, runs migrations and checks, and reports success", async () => {
    mockTempKnex = createFakeTempKnex(validConfig());
    const { svc, backupService, metrics, exec } = loadService();
    backupService.listBackups.mockReturnValue([
      { filename: BACKUP_FILE, size: 1234, timestamp: "2026-08-22T02:00:00.000Z" },
    ]);

    const report = await svc.verifyLatestBackup();

    expect(report.success).toBe(true);
    expect(report.backup.filename).toBe(BACKUP_FILE);
    expect(report.checks.tableRowCounts.counts.tips).toBe(12);
    expect(report.checks.summary.tablesCounted).toBe(4);
    expect(exec).toHaveBeenCalledWith(expect.stringContaining("sqlite3"), expect.any(Function));
    expect(mockTempKnex.migrate.latest).toHaveBeenCalled();
    expect(mockTempKnex.destroy).toHaveBeenCalled();
    expect(metrics.backupVerificationSuccess.set).toHaveBeenCalledWith(1);
    expect(metrics.backupVerificationDurationSeconds.observe).toHaveBeenCalledWith(
      expect.any(Number),
    );
    expect(svc.getVerificationStatus().lastVerification.success).toBe(true);
  });

  it("marks the drill failed, sets the gauge to 0, and logs CRITICAL on integrity violations", async () => {
    mockTempKnex = createFakeTempKnex(
      validConfig({
        tables: ["tips", "webhook_deliveries", "webhooks"],
        rawTables: [{ name: "tips" }, { name: "webhook_deliveries" }, { name: "webhooks" }],
        orphans: { webhook_deliveries: { count: "2" } },
        orphanSamples: {
          webhook_deliveries: [
            { "webhook_deliveries.webhook_id": "w1" },
            { "webhook_deliveries.webhook_id": "w2" },
          ],
        },
        rowCounts: {},
      }),
    );
    const { svc, backupService, metrics, logger } = loadService();
    backupService.listBackups.mockReturnValue([
      { filename: BACKUP_FILE, size: 1234, timestamp: "2026-08-22T02:00:00.000Z" },
    ]);
    const errorSpy = jest.spyOn(logger, "error").mockImplementation(() => {});

    const report = await svc.verifyLatestBackup();

    expect(report.success).toBe(false);
    expect(report.checks.orphanedForeignKeys.violations).toHaveLength(1);
    expect(report.checks.orphanedForeignKeys.violations[0]).toMatchObject({
      check: "orphaned_foreign_key",
      count: 2,
      sampleValues: ["w1", "w2"],
    });
    expect(metrics.backupVerificationSuccess.set).toHaveBeenCalledWith(0);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ backup: BACKUP_FILE }),
      expect.stringContaining("CRITICAL"),
    );
  });

  it("flags non-positive and address-less tips as balance inconsistencies", async () => {
    mockTempKnex = createFakeTempKnex(
      validConfig({
        tipCounts: {
          nonPositive: { count: "1" },
          missingAddress: { count: "3" },
        },
      }),
    );
    const { svc, backupService } = loadService();
    backupService.listBackups.mockReturnValue([
      { filename: BACKUP_FILE, size: 1234, timestamp: "2026-08-22T02:00:00.000Z" },
    ]);

    const report = await svc.verifyLatestBackup();

    expect(report.success).toBe(false);
    const balanceViolations = report.checks.balanceConsistency.violations;
    expect(balanceViolations.some((v) => v.detail.includes("amount_stroops <= 0"))).toBe(true);
    expect(balanceViolations.some((v) => v.detail.includes("missing to_addr"))).toBe(true);
  });

  it("throws when no backups exist", async () => {
    mockTempKnex = createFakeTempKnex(validConfig());
    const { svc, backupService } = loadService();
    backupService.listBackups.mockReturnValue([]);

    await expect(svc.verifyLatestBackup()).rejects.toThrow(/No backups found/);
  });
});

describe("backupVerificationService cron", () => {
  it("schedules the weekly drill with the default cron expression", () => {
    mockTempKnex = createFakeTempKnex(validConfig());
    const { svc, cron } = loadService();

    const task = svc.startVerificationCron();

    expect(cron.schedule).toHaveBeenCalledWith("0 4 * * 0", expect.any(Function));
    expect(task).toBeDefined();
    svc.stopVerificationCron();
    expect(task.stop).toHaveBeenCalled();
  });

  it("honors the BACKUP_VERIFY_SCHEDULE override", () => {
    process.env.BACKUP_VERIFY_SCHEDULE = "0 5 * * 1";
    mockTempKnex = createFakeTempKnex(validConfig());
    const { svc, cron } = loadService();

    svc.startVerificationCron();

    expect(cron.schedule).toHaveBeenCalledWith("0 5 * * 1", expect.any(Function));
  });

  it("does not schedule when BACKUP_VERIFY_ENABLED=false", () => {
    process.env.BACKUP_VERIFY_ENABLED = "false";
    mockTempKnex = createFakeTempKnex(validConfig());
    const { svc, cron } = loadService();

    expect(svc.startVerificationCron()).toBeNull();
    expect(cron.schedule).not.toHaveBeenCalled();
  });
});

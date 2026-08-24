/**
 * src/services/backupVerificationService.js
 * Automated backup restore-and-verify drills (Issue #799).
 *
 * A backup that exists but cannot be restored is worthless — and this is only
 * discovered during an actual disaster. This service periodically restores the
 * latest backup into a throwaway database, applies pending migrations, and runs
 * integrity checks (orphaned foreign keys, balance consistency, table row
 * counts) so a broken backup is caught while there is still time to fix it.
 *
 * Flow per drill:
 *   1. fetch the latest backup file
 *   2. restore it into a temp database (temp SQLite file, or a temp Postgres DB)
 *   3. run pending migrations against the temp database
 *   4. run integrity checks against the temp database
 *   5. emit Prometheus metrics (backup_verification_success,
 *      backup_verification_duration_seconds), CRITICAL-log failures, audit-log
 *      the outcome, then tear the temp database down
 */

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { exec } = require("child_process");
const { promisify } = require("util");
const knex = require("knex");
const cron = require("node-cron");
const { listBackups, BACKUP_DIR } = require("./backupService");
const metrics = require("./metricsService");
const logger = require("../utils/logger");

const execAsync = promisify(exec);

const MIGRATIONS_DIR = path.join(__dirname, "..", "..", "migrations");

/**
 * Default: weekly, Sunday 04:00 UTC — after the daily 02:00 backup
 * (BACKUP_SCHEDULE) has produced a fresh dump to verify.
 */
const DEFAULT_VERIFY_SCHEDULE = "0 4 * * 0";

// ─── Environment (read lazily so tests and deployments can override) ─────────

function getBackupDir() {
  return process.env.BACKUP_DIR || BACKUP_DIR;
}

function getVerifySchedule() {
  return process.env.BACKUP_VERIFY_SCHEDULE || DEFAULT_VERIFY_SCHEDULE;
}

function isVerifyEnabled() {
  return process.env.BACKUP_VERIFY_ENABLED !== "false";
}

function isPostgresProvider() {
  return (process.env.DB_PROVIDER || "sqlite").toLowerCase() === "postgres";
}

// ─── Foreign-key relationships to check for orphans ──────────────────────────
// These are the application-level relationships that matter for integrity but
// are not all enforced by the schema, so an orphan check is the only guard.

const FOREIGN_KEY_CHECKS = [
  ["webhook_deliveries", "webhook_id", "webhooks", "id"],
  ["webhook_events", "webhook_id", "webhooks", "id"],
  ["dead_letter_queue", "delivery_id", "webhook_deliveries", "id"],
  ["turrets_history", "deployment_id", "turrets_deployments", "id"],
  ["pending_executions", "schedule_id", "scheduled_transactions", "id"],
  ["scheduled_txn_executions", "schedule_id", "scheduled_transactions", "id"],
  ["contact_group_membership", "contact_id", "contacts", "id"],
  ["contact_group_membership", "group_id", "contact_groups", "id"],
];

// ─── Temp database lifecycle ─────────────────────────────────────────────────

function createTempDbPath() {
  return path.join(os.tmpdir(), `finchippay-verify-${process.pid}-${Date.now()}.sqlite`);
}

/**
 * Restore a SQLite backup into a fresh temp file. Backups produced with the
 * sqlite3 CLI are `.dump` text; if the CLI is absent the backup is a raw copy
 * of the database file, in which case we copy it and let migrations reconcile
 * the schema.
 */
async function restoreSqliteBackup(backupPath, tempFile) {
  try {
    await execAsync(`sqlite3 "${tempFile}" < "${backupPath}"`);
  } catch {
    fs.copyFileSync(backupPath, tempFile);
  }
}

function getPgAdminUrl() {
  const url = new URL(process.env.DATABASE_URL);
  url.pathname = "/postgres";
  return url.toString();
}

function getPgTempUrl(name) {
  const url = new URL(process.env.DATABASE_URL);
  url.pathname = `/${name}`;
  return url.toString();
}

async function createTempPgDatabase() {
  const name = `finchippay_verify_${process.pid}_${Date.now()}`;
  await execAsync(`psql "${getPgAdminUrl()}" -c "CREATE DATABASE \\"${name}\\""`);
  return name;
}

async function dropTempPgDatabase(name) {
  try {
    await execAsync(`psql "${getPgAdminUrl()}" -c "DROP DATABASE IF EXISTS \\"${name}\\""`);
  } catch (err) {
    logger.warn({ err, name }, "Failed to drop temporary verification database");
  }
}

function createTempKnexForSqlite(filename) {
  return knex({
    client: "better-sqlite3",
    connection: { filename },
    useNullAsDefault: true,
    pool: {
      afterCreate: (conn, cb) => {
        conn.pragma("journal_mode = WAL");
        conn.pragma("foreign_keys = ON");
        cb(null, conn);
      },
    },
    migrations: { directory: MIGRATIONS_DIR },
  });
}

function createTempKnexForPg(connectionString) {
  return knex({
    client: "pg",
    connection: connectionString,
    migrations: { directory: MIGRATIONS_DIR },
  });
}

// ─── Integrity checks ────────────────────────────────────────────────────────

/**
 * For each known FK relationship, count child rows whose parent is missing.
 * Tables that do not exist in the restored backup are skipped so old backups
 * (predating a migration) still verify cleanly.
 */
async function checkOrphanedForeignKeys(tempKnex) {
  const checked = [];
  const violations = [];

  for (const [child, childCol, parent, parentCol] of FOREIGN_KEY_CHECKS) {
    if (!(await tempKnex.schema.hasTable(child))) continue;
    if (!(await tempKnex.schema.hasTable(parent))) continue;
    checked.push({ child, parent, column: childCol });

    const orphansQuery = (qb) =>
      qb
        .leftJoin(parent, `${child}.${childCol}`, `${parent}.${parentCol}`)
        .whereNotNull(`${child}.${childCol}`)
        .whereNull(`${parent}.${parentCol}`);

    const row = await orphansQuery(tempKnex(child)).count("* as count").first();
    const orphans = Number(row ? row.count : 0);
    if (orphans > 0) {
      const samples = await orphansQuery(tempKnex(child)).limit(5).select(`${child}.${childCol}`);
      violations.push({
        check: "orphaned_foreign_key",
        detail: `${child}.${childCol} references ${parent}.${parentCol}`,
        count: orphans,
        sampleValues: (samples || []).map((s) => s[`${child}.${childCol}`]),
      });
    }
  }

  return { checked, violations, ok: violations.length === 0 };
}

/**
 * Balance-consistency checks over the payment/tip data:
 *   - stroop-denominated tips must not carry a non-positive amount
 *   - stroop-denominated tips must reference both sender and recipient
 *   - scheduled transaction amounts must be positive numbers
 */
async function checkBalanceConsistency(tempKnex) {
  const checked = [];
  const violations = [];

  if (await tempKnex.schema.hasTable("tips")) {
    checked.push("tips.amount_stroops > 0");
    const nonPositive = await tempKnex("tips")
      .whereNotNull("amount_stroops")
      .andWhere("amount_stroops", "<=", 0)
      .count("* as count")
      .first();
    const nonPositiveCount = Number(nonPositive ? nonPositive.count : 0);
    if (nonPositiveCount > 0) {
      violations.push({
        check: "balance_consistency",
        detail: `${nonPositiveCount} tip(s) have amount_stroops <= 0`,
        count: nonPositiveCount,
      });
    }

    for (const col of ["from_addr", "to_addr"]) {
      checked.push(`tips.${col} present for stroop-denominated tips`);
      const missing = await tempKnex("tips")
        .whereNotNull("amount_stroops")
        .whereNull(col)
        .count("* as count")
        .first();
      const missingCount = Number(missing ? missing.count : 0);
      if (missingCount > 0) {
        violations.push({
          check: "balance_consistency",
          detail: `${missingCount} tip(s) with amount_stroops are missing ${col}`,
          count: missingCount,
        });
      }
    }
  }

  if (await tempKnex.schema.hasTable("scheduled_transactions")) {
    checked.push("scheduled_transactions.amount is a positive number");
    const schedules = await tempKnex("scheduled_transactions").select("id", "amount");
    const invalid = (schedules || []).filter((s) => {
      const n = Number(s.amount);
      return !Number.isFinite(n) || n <= 0;
    });
    if (invalid.length > 0) {
      violations.push({
        check: "balance_consistency",
        detail: `${invalid.length} scheduled transaction(s) have a non-positive amount`,
        count: invalid.length,
        sampleIds: invalid.slice(0, 5).map((s) => s.id),
      });
    }
  }

  return { checked, violations, ok: violations.length === 0 };
}

async function listTables(tempKnex) {
  const result = isPostgresProvider()
    ? await tempKnex.raw("SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public'")
    : await tempKnex.raw(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
      );
  const rows = Array.isArray(result) ? result : result.rows || [];
  return rows.map((r) => r.name).sort();
}

/** Informational row counts per table in the restored backup. */
async function checkTableRowCounts(tempKnex) {
  const tables = await listTables(tempKnex);
  const counts = {};
  for (const table of tables) {
    const row = await tempKnex(table).count("* as count").first();
    counts[table] = Number(row ? row.count : 0);
  }
  return { checked: tables, counts, violations: [], ok: true };
}

async function runIntegrityChecks(tempKnex) {
  const orphanedForeignKeys = await checkOrphanedForeignKeys(tempKnex);
  const balanceConsistency = await checkBalanceConsistency(tempKnex);
  const tableRowCounts = await checkTableRowCounts(tempKnex);

  const violations = [...orphanedForeignKeys.violations, ...balanceConsistency.violations];

  return {
    orphanedForeignKeys,
    balanceConsistency,
    tableRowCounts,
    ok: violations.length === 0,
    violations,
    summary: {
      orphanedForeignKeyPairsChecked: orphanedForeignKeys.checked.length,
      balanceChecksRun: balanceConsistency.checked.length,
      tablesCounted: tableRowCounts.checked.length,
    },
  };
}

// ─── Audit trail ─────────────────────────────────────────────────────────────

async function writeAuditLog(action, details) {
  try {
    const db = require("../db");
    await db("audit_log").insert({
      action,
      details: JSON.stringify(details),
    });
  } catch (err) {
    logger.warn({ err, action }, "Failed to write backup verification audit log entry");
  }
}

// ─── Orchestration ───────────────────────────────────────────────────────────

let lastVerification = null;

/**
 * Restore the latest backup into a temp database, run migrations and integrity
 * checks, emit metrics, and report whether the backup is restorable.
 *
 * @returns {Promise<{success: boolean, verifiedAt: string, backup: object,
 *                    checks: object, durationMs: number}>}
 */
async function verifyLatestBackup() {
  const startedAt = Date.now();
  let tempKnex = null;
  let tempPgName = null;
  let tempFile = null;

  try {
    const backups = listBackups();
    if (!backups || backups.length === 0) {
      throw new Error("No backups found to verify — run a backup first");
    }
    const latest = backups[0];
    const backupPath = path.join(getBackupDir(), path.basename(latest.filename));
    if (!fs.existsSync(backupPath)) {
      throw new Error(`Backup file not found: ${latest.filename}`);
    }

    // 1. Restore into a throwaway database.
    if (isPostgresProvider()) {
      tempPgName = await createTempPgDatabase();
      await execAsync(`psql "${getPgTempUrl(tempPgName)}" < "${backupPath}"`);
      tempKnex = createTempKnexForPg(getPgTempUrl(tempPgName));
    } else {
      tempFile = createTempDbPath();
      await restoreSqliteBackup(backupPath, tempFile);
      tempKnex = createTempKnexForSqlite(tempFile);
    }

    // 2. Apply any migrations the backup predates.
    await tempKnex.migrate.latest();

    // 3. Integrity checks.
    const checks = await runIntegrityChecks(tempKnex);

    const durationMs = Date.now() - startedAt;
    const report = {
      success: checks.ok,
      verifiedAt: new Date().toISOString(),
      backup: latest,
      checks,
      durationMs,
    };
    lastVerification = report;

    metrics.backupVerificationSuccess.set(report.success ? 1 : 0);
    metrics.backupVerificationDurationSeconds.observe(durationMs / 1000);

    if (report.success) {
      logger.info(
        { backup: latest.filename, durationMs, summary: checks.summary },
        "Backup verification drill passed",
      );
    } else {
      logger.error(
        { backup: latest.filename, durationMs, violations: checks.violations },
        "CRITICAL: backup verification drill FAILED — latest backup restored but integrity checks found violations",
      );
    }

    await writeAuditLog(report.success ? "backup_verify_passed" : "backup_verify_failed", {
      backup: latest.filename,
      durationMs,
      violations: checks.violations,
    });

    return report;
  } catch (err) {
    metrics.backupVerificationSuccess.set(0);
    metrics.backupVerificationDurationSeconds.observe((Date.now() - startedAt) / 1000);
    throw err;
  } finally {
    if (tempKnex) {
      try {
        await tempKnex.destroy();
      } catch {
        // Best-effort teardown.
      }
    }
    if (tempPgName) {
      await dropTempPgDatabase(tempPgName);
    }
    if (tempFile && fs.existsSync(tempFile)) {
      try {
        fs.unlinkSync(tempFile);
      } catch {
        // Best-effort cleanup.
      }
    }
  }
}

// ─── Weekly cron ─────────────────────────────────────────────────────────────

let scheduledTask = null;

function startVerificationCron() {
  if (scheduledTask) return scheduledTask;
  if (!isVerifyEnabled()) {
    logger.info("Backup verification cron disabled (BACKUP_VERIFY_ENABLED=false)");
    return null;
  }
  const schedule = getVerifySchedule();
  logger.info({ schedule }, "Starting weekly backup verification cron");
  scheduledTask = cron.schedule(schedule, async () => {
    try {
      await verifyLatestBackup();
    } catch (err) {
      logger.error({ err }, "CRITICAL: automated backup verification cron run failed");
      metrics.backupVerificationSuccess.set(0);
    }
  });
  return scheduledTask;
}

function stopVerificationCron() {
  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask = null;
  }
}

function getVerificationStatus() {
  return {
    lastVerification,
    schedule: getVerifySchedule(),
    enabled: isVerifyEnabled(),
  };
}

module.exports = {
  verifyLatestBackup,
  startVerificationCron,
  stopVerificationCron,
  getVerificationStatus,
  runIntegrityChecks,
};

"use strict";

const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");
const cron = require("node-cron");
const logger = require("../utils/logger");

const BACKUP_DIR = process.env.BACKUP_DIR || path.join(process.cwd(), "backups");
const BACKUP_SCHEDULE = process.env.BACKUP_SCHEDULE || "0 2 * * *";

let lastBackupAt = null;
let lastBackupSize = null;
let scheduledTask = null;

function ensureBackupDir() {
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }
}

function formatDate(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  const yyyy = date.getFullYear();
  const mm = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());
  const hh = pad(date.getHours());
  const min = pad(date.getMinutes());
  const ss = pad(date.getSeconds());
  return `${yyyy}-${mm}-${dd}-${hh}${min}${ss}`;
}

async function performBackup() {
  ensureBackupDir();
  const filename = `backup-${formatDate()}.sql`;
  const filePath = path.join(BACKUP_DIR, filename);

  const provider = process.env.DB_PROVIDER || "sqlite";
  let command = "";

  if (provider === "postgres") {
    const dbUrl = process.env.DATABASE_URL || "";
    command = `pg_dump "${dbUrl}" > "${filePath}"`;
  } else {
    const dbFile = process.env.SQLITE_FILE || "./database.sqlite";
    command = `sqlite3 "${dbFile}" .dump > "${filePath}"`;
  }

  return new Promise((resolve, reject) => {
    exec(command, (error) => {
      if (error) {
        // Fallback for sqlite file copy if sqlite3 CLI is absent
        if (
          provider !== "postgres" &&
          fs.existsSync(process.env.SQLITE_FILE || "./database.sqlite")
        ) {
          try {
            fs.copyFileSync(process.env.SQLITE_FILE || "./database.sqlite", filePath);
          } catch (copyErr) {
            return reject(copyErr);
          }
        } else {
          return reject(error);
        }
      }

      const stats = fs.statSync(filePath);
      lastBackupAt = new Date().toISOString();
      lastBackupSize = stats.size;

      applyRetention();

      resolve({
        filename,
        size: stats.size,
        timestamp: lastBackupAt,
      });
    });
  });
}

async function restoreBackup(filename) {
  ensureBackupDir();
  const filePath = path.join(BACKUP_DIR, path.basename(filename));

  if (!fs.existsSync(filePath)) {
    throw new Error(`Backup file not found: ${filename}`);
  }

  const provider = process.env.DB_PROVIDER || "sqlite";
  let command = "";

  if (provider === "postgres") {
    const dbUrl = process.env.DATABASE_URL || "";
    command = `psql "${dbUrl}" < "${filePath}"`;
  } else {
    const dbFile = process.env.SQLITE_FILE || "./database.sqlite";
    command = `sqlite3 "${dbFile}" < "${filePath}"`;
  }

  return new Promise((resolve, reject) => {
    exec(command, (error) => {
      if (error) {
        // Fallback for sqlite direct file restore
        if (provider !== "postgres") {
          try {
            fs.copyFileSync(filePath, process.env.SQLITE_FILE || "./database.sqlite");
            return resolve({ restored: true, filename });
          } catch (copyErr) {
            return reject(copyErr);
          }
        }
        return reject(error);
      }
      resolve({ restored: true, filename });
    });
  });
}

function listBackups() {
  ensureBackupDir();
  const files = fs.readdirSync(BACKUP_DIR);
  return files
    .filter((f) => f.startsWith("backup-"))
    .map((f) => {
      const filePath = path.join(BACKUP_DIR, f);
      const stats = fs.statSync(filePath);
      return {
        filename: f,
        size: stats.size,
        timestamp: stats.mtime.toISOString(),
      };
    })
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
}

function applyRetention() {
  ensureBackupDir();
  const retentionDaily = parseInt(process.env.BACKUP_RETENTION_DAILY || "7", 10);
  const backups = listBackups();

  if (backups.length > retentionDaily) {
    const toDelete = backups.slice(retentionDaily);
    for (const b of toDelete) {
      try {
        fs.unlinkSync(path.join(BACKUP_DIR, b.filename));
      } catch {
        // Ignore deletion error
      }
    }
  }
}

function startScheduler() {
  if (scheduledTask) return;
  scheduledTask = cron.schedule(BACKUP_SCHEDULE, async () => {
    try {
      await performBackup();
    } catch (err) {
      logger.error({ err }, "Automated backup failed");
    }
  });
}

function getBackupStatus() {
  return {
    lastBackupAt,
    lastBackupSize,
    nextBackupAt: scheduledTask ? "scheduled" : null,
  };
}

module.exports = {
  performBackup,
  restoreBackup,
  listBackups,
  applyRetention,
  startScheduler,
  getBackupStatus,
};

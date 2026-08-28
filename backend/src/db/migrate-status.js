#!/usr/bin/env node

/**
 * src/db/migrate-status.js
 * Report migration status and fail (exit 1) if any migrations are pending.
 *
 * Used by `npm run migrate:status` and the CI gate: unlike the built-in
 * `knex migrate:status`, this exits non-zero when the database schema is not
 * fully migrated, so CI fails on unrun migrations.
 *
 * Usage: node src/db/migrate-status.js
 */

"use strict";

require("dotenv").config();

const logger = require("../utils/logger");
const knex = require("./connection");

async function main() {
  try {
    // knex.migrate.list() → [completedMigrations, pendingMigrations]. Entry
    // shape varies by knex version (string filename or { name/file }), so
    // normalise before printing.
    const label = (m) => (typeof m === "string" ? m : m.name || m.file || JSON.stringify(m));

    const [completed, pending] = await knex.migrate.list();

    logger.info({ completed: completed.length, pending: pending.length }, "Migration status");
    completed.forEach((m) => logger.info({ migration: label(m), status: "completed" }));
    pending.forEach((m) => logger.info({ migration: label(m), status: "pending" }));

    await knex.destroy();

    if (pending.length > 0) {
      logger.error(
        { pendingCount: pending.length },
        "Pending migrations detected — run `npm run migrate`",
      );
      process.exit(1);
    }

    logger.info("Database schema is up to date");
    process.exit(0);
  } catch (err) {
    logger.error({ err }, "Failed to read migration status");
    await knex.destroy();
    process.exit(1);
  }
}

main();

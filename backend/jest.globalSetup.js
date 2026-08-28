/**
 * jest.globalSetup.js
 * Runs once before the test suite.
 *
 * Provisions a fresh SQLite test database and runs all migrations against it so
 * tests execute against the real schema rather than hand-rolled tables. The
 * DB_FILENAME default set here is inherited by worker processes; individual
 * tests that manage their own database (e.g. by overriding DB_FILENAME before
 * requiring the connection) are unaffected.
 */

"use strict";

const fs = require("fs");
const path = require("path");

module.exports = async function globalSetup() {
  process.env.NODE_ENV = process.env.NODE_ENV || "test";

  // Skip file provisioning when tests are pointed at Postgres.
  if ((process.env.DB_PROVIDER || "").toLowerCase() === "postgres") {
    return;
  }

  const dbFile = process.env.DB_FILENAME || path.join(__dirname, "data", "test.db");
  process.env.DB_FILENAME = dbFile;

  // Ensure the data directory exists and start from a clean database.
  fs.mkdirSync(path.dirname(dbFile), { recursive: true });
  for (const suffix of ["", "-wal", "-shm"]) {
    fs.rmSync(dbFile + suffix, { force: true });
  }

  const config = require("./knexfile").test;
  const knex = require("knex")(config);
  try {
    await knex.migrate.latest();
  } finally {
    await knex.destroy();
  }
};

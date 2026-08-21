/**
 * knexfile.js
 * Canonical Knex configuration for the Finchippay backend.
 *
 * Exposes one config per environment (development / test / production), keyed by
 * NODE_ENV. This is the single source of truth for database configuration — the
 * runtime connection (src/db/connection.js) and the `knex` CLI both read it.
 *
 * Environment variables:
 *   DB_PROVIDER  — "sqlite" (default for dev/test) or "postgres". Set to
 *                  "postgres" to point dev/test at a Postgres instance.
 *   DB_FILENAME  — SQLite file path (dev default: ./data/finchippay.db,
 *                  test default: ./data/test.db).
 *   DATABASE_URL — PostgreSQL connection string (required in production, or
 *                  whenever DB_PROVIDER=postgres).
 */

"use strict";

require("dotenv").config();

// Docker secrets (DATABASE_URL_FILE, etc.) — must run before DATABASE_URL is
// read below. Required here (not just in server.js) because the `knex` CLI
// (migrate/seed) loads this file directly, bypassing server.js entirely.
require("./src/config/dockerSecrets");

const path = require("path");

const MIGRATIONS_DIR = path.join(__dirname, "migrations");
const SEEDS_DIR = path.join(__dirname, "seeds");

const migrations = {
  directory: MIGRATIONS_DIR,
  tableName: "knex_migrations",
};

const seeds = {
  directory: SEEDS_DIR,
};

/**
 * Build an SQLite (better-sqlite3) config pointing at the given default file.
 * @param {string} defaultFilename
 */
function sqliteConfig(defaultFilename) {
  const filename = process.env.DB_FILENAME || defaultFilename;
  return {
    client: "better-sqlite3",
    connection: { filename },
    pool: {
      afterCreate: (conn, cb) => {
        // WAL for better concurrent reads; enforce FK constraints (off by
        // default in SQLite).
        conn.pragma("journal_mode = WAL");
        conn.pragma("foreign_keys = ON");
        cb(null, conn);
      },
    },
    useNullAsDefault: true,
    migrations,
    seeds,
  };
}

/**
 * Build a PostgreSQL (pg) config from DATABASE_URL.
 *
 * Does NOT throw when the connection string is missing: this file is required
 * for its side-effect-free config regardless of the active environment (both
 * the runtime and the `knex` CLI load the whole module), so a missing
 * DATABASE_URL must not blow up loading, e.g. the sqlite dev/test path. The
 * "DATABASE_URL is required" check happens lazily in src/db/connection.js for
 * the environment that is actually selected.
 */
function postgresConfig() {
  const connectionString = process.env.DATABASE_URL || process.env.DATABASE_URL_PROD;

  return {
    client: "pg",
    connection: connectionString,
    pool: { min: 2, max: 10 },
    useNullAsDefault: false,
    migrations,
    seeds,
  };
}

const dbProvider = (process.env.DB_PROVIDER || "").toLowerCase();
const usePostgres = dbProvider === "postgres";

module.exports = {
  development: usePostgres
    ? postgresConfig()
    : sqliteConfig(path.join(__dirname, "data", "finchippay.db")),

  test: usePostgres ? postgresConfig() : sqliteConfig(path.join(__dirname, "data", "test.db")),

  // Production defaults to PostgreSQL. Set DB_PROVIDER=sqlite only for
  // single-node / evaluation deployments.
  production:
    usePostgres || dbProvider !== "sqlite"
      ? postgresConfig()
      : sqliteConfig(path.join(__dirname, "data", "finchippay.db")),
};

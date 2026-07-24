/**
 * src/db/connection.js
 * Database connection layer using Knex.
 *
 * Supports SQLite (dev/test) and PostgreSQL (production) via the DB_PROVIDER
 * environment variable. Defaults to SQLite when unset.
 *
 * Configuration:
 *   DB_PROVIDER=sqlite    → uses DB_FILENAME (default: ./data/finchippay.db)
 *   DB_PROVIDER=postgres  → uses DATABASE_URL (required)
 */

"use strict";

const path = require("path");

/** @type {import('knex').Knex.Config} */
function buildConfig() {
  const provider = (process.env.DB_PROVIDER || "sqlite").toLowerCase();

  if (provider === "postgres") {
    const connectionString =
      process.env.DATABASE_URL || process.env.DATABASE_URL_PROD;

    if (!connectionString) {
      throw new Error("DATABASE_URL must be set when DB_PROVIDER=postgres");
    }

    return {
      client: "pg",
      connection: connectionString,
      pool: { min: 2, max: 10 },
      migrations: {
        directory: path.join(__dirname, "migrations"),
        tableName: "knex_migrations",
      },
      useNullAsDefault: false,
    };
  }

  // Default: SQLite
  const dbFilename =
    process.env.DB_FILENAME ||
    path.join(__dirname, "..", "..", "data", "finchippay.db");

  return {
    client: "better-sqlite3",
    connection: { filename: dbFilename },
    pool: {
      afterCreate: (conn, cb) => {
        // Enable WAL mode for better concurrent read performance
        conn.pragma("journal_mode = WAL");
        conn.pragma("foreign_keys = ON");
        cb(null, conn);
      },
    },
    migrations: {
      directory: path.join(__dirname, "migrations"),
      tableName: "knex_migrations",
    },
    useNullAsDefault: true,
  };
}

const config = buildConfig();
const knex = require("knex")(config);

module.exports = knex;

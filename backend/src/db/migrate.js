#!/usr/bin/env node

/**
 * src/db/migrate.js
 * Run database migrations.
 *
 * Usage:
 *   node src/db/migrate.js              # run pending migrations
 *   node src/db/migrate.js rollback     # rollback the last batch
 *   node src/db/migrate.js seed         # seed initial data
 *
 * Environment:
 *   DB_PROVIDER  — "sqlite" (default) or "postgres"
 *   DATABASE_URL — PostgreSQL connection string (required for postgres)
 *   DB_FILENAME  — SQLite file path (default: backend/data/finchippay.db)
 */

"use strict";

require("dotenv").config();

const path = require("path");
const fs = require("fs");
const knex = require("./connection");

const command = process.argv[2] || "latest";

async function ensureDataDir() {
  const provider = (process.env.DB_PROVIDER || "sqlite").toLowerCase();
  if (provider === "sqlite") {
    const dbFilename =
      process.env.DB_FILENAME ||
      path.join(__dirname, "..", "..", "data", "finchippay.db");
    const dir = path.dirname(dbFilename);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

async function seed() {
  // Seed the usernames table with a default mapping for the reserved "alice" username
  // if it doesn't already exist. This is used by the account controller test.
  const existing = await knex("usernames").where("username", "alice").first();
  if (!existing) {
    await knex("usernames").insert({
      username: "alice",
      public_key: "GBRPYHIL2CI3WHZDTOOQFC6EB4KJJGUJLVXKJ46ZGFWTTNQNXNHTJXW",
      registered_at: new Date().toISOString(),
    });
    console.log('Seeded reserved username "alice".');
  }
}

async function main() {
  try {
    await ensureDataDir();

    if (command === "seed") {
      await seed();
      console.log("Seed complete.");
    } else if (command === "rollback") {
      const [batchNo, log] = await knex.migrate.rollback();
      if (log.length === 0) {
        console.log("No migrations to roll back.");
      } else {
        console.log(`Rolled back batch ${batchNo}:`);
        log.forEach((m) => console.log(`  - ${m}`));
      }
    } else {
      // Default: run latest migrations
      const [batchNo, log] = await knex.migrate.latest();
      if (log.length === 0) {
        console.log("Already up to date.");
      } else {
        console.log(`Ran batch ${batchNo}:`);
        log.forEach((m) => console.log(`  - ${m}`));
      }
    }

    await knex.destroy();
    process.exit(0);
  } catch (err) {
    console.error("Migration failed:", err.message);
    console.error(err.stack);
    await knex.destroy();
    process.exit(1);
  }
}

main();

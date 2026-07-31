/**
 * Migration 003: Create webhooks table.
 *
 * Stores webhook registrations for Stellar account payment monitoring.
 *
 * NOTE: The `secret_hash` column holds an HMAC-SHA256(WEBHOOK_SECRET_KEY, id:secret)
 * hex digest. Raw secrets are never stored. This supersedes an earlier version
 * of this migration that used a plaintext `secret` column (#72).
 *
 * The live table is also bootstrapped inline by db/webhookDb.js using
 * node:sqlite (no Knex dependency at runtime). This Knex migration is kept
 * for teams that run the centralised migrate.js runner against a shared DB.
 */

exports.up = function (knex) {
  return knex.schema.createTable("webhooks", (table) => {
    table.string("id").primary();
    table.string("public_key").notNullable();
    table.string("url").notNullable();
    table.string("secret_hash").notNullable().comment("HMAC-SHA256 digest — never plaintext");
    table.timestamp("created_at").defaultTo(knex.fn.now());
    table.boolean("active").notNullable().defaultTo(true);
    table.index("public_key");
    table.index("active");
  });
};

exports.down = function (knex) {
  return knex.schema.dropTableIfExists("webhooks");
};

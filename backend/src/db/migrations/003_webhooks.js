/**
 * Migration 003: Create webhooks table.
 *
 * Stores webhook registrations for Stellar account payment monitoring.
 */

exports.up = function (knex) {
  return knex.schema.createTable("webhooks", (table) => {
    table.string("id").primary();
    table.string("public_key").notNullable();
    table.string("url").notNullable();
    table.string("secret").notNullable();
    table.timestamp("created_at").defaultTo(knex.fn.now());
    table.index("public_key");
  });
};

exports.down = function (knex) {
  return knex.schema.dropTableIfExists("webhooks");
};

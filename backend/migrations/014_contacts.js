/**
 * Migration 014: Create contacts and contact_groups tables.
 *
 * Stores synced contacts and contact groups per Stellar public key,
 * enabling cross-device address book sync and group-based batch payments.
 */

exports.up = function (knex) {
  return knex.schema
    .createTable("contact_groups", (table) => {
      table.increments("id").primary();
      table.string("public_key").notNullable();
      table.string("name").notNullable();
      table.string("color").defaultTo("#6366f1");
      table.string("icon").defaultTo("users");
      table.timestamp("created_at").defaultTo(knex.fn.now());
      table.unique(["public_key", "name"]);
    })
    .createTable("contacts", (table) => {
      table.increments("id").primary();
      table.string("public_key").notNullable();
      table.string("name").notNullable();
      table.string("stellar_address").notNullable();
      table.string("federation_address").nullable();
      table.string("memo").nullable();
      table.specificType("tags", "text[]").defaultTo("{}");
      table.timestamp("created_at").defaultTo(knex.fn.now());
      table.timestamp("updated_at").defaultTo(knex.fn.now());
      table.unique(["public_key", "stellar_address"]);
    })
    .createTable("contact_group_membership", (table) => {
      table.increments("id").primary();
      table.integer("contact_id").references("id").inTable("contacts").onDelete("CASCADE");
      table.integer("group_id").references("id").inTable("contact_groups").onDelete("CASCADE");
      table.unique(["contact_id", "group_id"]);
    });
};

exports.down = function (knex) {
  return knex.schema
    .dropTableIfExists("contact_group_membership")
    .dropTableIfExists("contacts")
    .dropTableIfExists("contact_groups");
};

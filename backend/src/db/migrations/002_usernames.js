/**
 * Migration 002: Create usernames table.
 *
 * Maps Finchippay usernames to Stellar public keys for SEP-0002 federation.
 */

exports.up = function (knex) {
  return knex.schema.createTable("usernames", (table) => {
    table.string("username").unique().notNullable();
    table.string("public_key").unique().notNullable();
    table.timestamp("registered_at").defaultTo(knex.fn.now());
  });
};

exports.down = function (knex) {
  return knex.schema.dropTableIfExists("usernames");
};

/**
 * Migration 001: Create tips table.
 *
 * Stores tip records for creator tipping feature.
 */

exports.up = function (knex) {
  return knex.schema.createTable("tips", (table) => {
    table.increments("id").primary();
    table.string("sender_pk").notNullable();
    table.string("creator_pk").notNullable();
    table.string("amount").notNullable();
    table.string("asset").defaultTo("XLM");
    table.string("memo").defaultTo("");
    table.string("tx_hash").defaultTo("");
    table.timestamp("created_at").defaultTo(knex.fn.now());
    table.index("creator_pk");
    table.index("sender_pk");
  });
};

exports.down = function (knex) {
  return knex.schema.dropTableIfExists("tips");
};

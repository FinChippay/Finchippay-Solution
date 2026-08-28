"use strict";

/**
 * Migration 028: Store resumable indexer cursors outside contract_events.
 */

exports.up = async function (knex) {
  const hasTable = await knex.schema.hasTable("indexer_state");

  if (!hasTable) {
    await knex.schema.createTable("indexer_state", (table) => {
      table.string("name", 128).primary();
      table.integer("last_processed_ledger").notNullable().defaultTo(0);
      table.string("last_processed_tx_id", 128).nullable();
      table.timestamp("updated_at").defaultTo(knex.fn.now());
    });
  }

  await knex("indexer_state")
    .insert({
      name: "contract_events",
      last_processed_ledger: 0,
      last_processed_tx_id: null,
    })
    .onConflict("name")
    .ignore();
};

exports.down = function (knex) {
  return knex.schema.dropTableIfExists("indexer_state");
};

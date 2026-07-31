/**
 * Migration: Create contract_events table for Soroban event indexer.
 *
 * Stores on-chain events emitted by the FinchippayContract on the
 * Soroban smart contract platform.
 */

exports.up = async function (knex) {
  await knex.schema.createTable("contract_events", (table) => {
    table.increments("id").primary();
    table.string("event_type", 64).notNullable();
    table.string("contract_id").notNullable();
    table.integer("ledger_sequence").notNullable();
    table.timestamp("emitted_at").notNullable();
    table.jsonb("payload").defaultTo("{}");
    table.timestamp("created_at").defaultTo(knex.fn.now());

    table.index("event_type");
    table.index("contract_id");
    table.index("ledger_sequence");
  });

  // Deduplication unique index. This must match the ON CONFLICT target used by
  // the event indexer (services/eventIndexer.js), which keys on the event's
  // payload `id` in addition to (ledger_sequence, contract_id, event_type).
  // The `id` is an expression, so it can't be expressed via table.unique() and
  // is provider-specific: JSON path extraction differs between Postgres and
  // SQLite.
  const client = knex.client.config.client;
  if (client === "pg" || client === "postgresql") {
    await knex.schema.raw(
      `CREATE UNIQUE INDEX contract_events_dedup
         ON contract_events
         (ledger_sequence, contract_id, event_type, ((payload->>'id')))`,
    );
  } else {
    // better-sqlite3 / sqlite3
    await knex.schema.raw(
      `CREATE UNIQUE INDEX contract_events_dedup
         ON contract_events
         (ledger_sequence, contract_id, event_type, json_extract(payload, '$.id'))`,
    );
  }
};

exports.down = function (knex) {
  return knex.schema.dropTableIfExists("contract_events");
};

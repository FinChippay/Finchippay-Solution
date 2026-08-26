/**
 * Migration 028: Add composite index on (from_addr, to_addr) for participant queries.
 *
 * The event indexer's query helpers (queryEventsByPublicKey, queryEventsByType,
 * getEventStats) will be rewritten to match participants via exact column
 * lookups instead of ILIKE on the serialized JSON payload.  This composite
 * index makes those lookups fast and eliminates the full-table scan.
 */

exports.up = async function (knex) {
  const client = knex.client.config.client;

  if (client === "pg" || client === "postgresql") {
    await knex.schema.raw(
      `CREATE INDEX IF NOT EXISTS idx_events_participants
         ON contract_events (from_addr, to_addr)`,
    );
  } else {
    // SQLite — composite index works the same way.
    await knex.schema.raw(
      `CREATE INDEX IF NOT EXISTS idx_events_participants
         ON contract_events (from_addr, to_addr)`,
    );
  }
};

exports.down = async function (knex) {
  await knex.schema.raw(
    `DROP INDEX IF EXISTS idx_events_participants`,
  );
};

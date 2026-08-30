/**
 * Migration 031: Participant address indexes for contract_events.
 *
 * The participant query paths (queryEventsByPublicKey, queryEventsByType,
 * getEventStats) previously matched participants with `payload::text ILIKE`,
 * a full-table scan that also produced false positives (a public key appearing
 * anywhere in the JSON, e.g. inside an unrelated memo string). The indexer
 * already extracts `from_addr` / `to_addr` into dedicated columns; this
 * migration adds btree indexes so exact-match lookups
 * (`from_addr = ? OR to_addr = ?`) can use the index instead of scanning
 * (WS4).
 */

exports.up = async function (knex) {
  const client = knex.client.config.client;

  if (client === "pg" || client === "postgresql") {
    await knex.schema.raw(
      "CREATE INDEX IF NOT EXISTS idx_contract_events_from_addr ON contract_events (from_addr)",
    );
    await knex.schema.raw(
      "CREATE INDEX IF NOT EXISTS idx_contract_events_to_addr ON contract_events (to_addr)",
    );
  } else {
    await knex.schema.raw(
      "CREATE INDEX IF NOT EXISTS idx_contract_events_from_addr ON contract_events (from_addr)",
    );
    await knex.schema.raw(
      "CREATE INDEX IF NOT EXISTS idx_contract_events_to_addr ON contract_events (to_addr)",
    );
  }
};

exports.down = async function (knex) {
  await knex.schema.raw("DROP INDEX IF EXISTS idx_contract_events_from_addr");
  await knex.schema.raw("DROP INDEX IF EXISTS idx_contract_events_to_addr");
};

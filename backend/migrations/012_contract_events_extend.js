/**
 * Migration 012: Extend contract_events schema and indexes.
 *
 * Adds:
 *  - from_addr / to_addr (participant addresses parsed from events)
 *  - amount_raw (string amount extracted from payment events)
 *  - Composite index on (event_type, ledger_sequence)
 *  - GIN index on payload for JSONB queries
 */

exports.up = async function (knex) {
  const hasColumn = async (table, col) => {
    const info = await knex(table).columnInfo();
    return col in info;
  };

  if (!(await hasColumn("contract_events", "from_addr"))) {
    await knex.schema.alterTable("contract_events", (t) => {
      t.string("from_addr", 64).nullable();
    });
  }
  if (!(await hasColumn("contract_events", "to_addr"))) {
    await knex.schema.alterTable("contract_events", (t) => {
      t.string("to_addr", 64).nullable();
    });
  }
  if (!(await hasColumn("contract_events", "amount_raw"))) {
    await knex.schema.alterTable("contract_events", (t) => {
      t.string("amount_raw", 64).nullable();
    });
  }

  const client = knex.client.config.client;

  // Composite index: (event_type, ledger_sequence)
  if (client === "pg" || client === "postgresql") {
    await knex.schema.raw(
      `CREATE INDEX IF NOT EXISTS idx_events_type_ledger
         ON contract_events (event_type, ledger_sequence)`,
    );
    // GIN index on payload for JSONB path queries
    await knex.schema.raw(
      `CREATE INDEX IF NOT EXISTS idx_events_payload
         ON contract_events USING GIN (payload)`,
    );
  } else {
    await knex.schema.raw(
      `CREATE INDEX IF NOT EXISTS idx_events_type_ledger
         ON contract_events (event_type, ledger_sequence)`,
    );
  }
};

exports.down = async function (knex) {
  await knex.schema.alterTable("contract_events", (t) => {
    t.dropColumn("from_addr");
    t.dropColumn("to_addr");
    t.dropColumn("amount_raw");
  });

  const client = knex.client.config.client;
  if (client === "pg" || client === "postgresql") {
    await knex.schema.raw("DROP INDEX IF EXISTS idx_events_type_ledger");
    await knex.schema.raw("DROP INDEX IF EXISTS idx_events_payload");
  } else {
    await knex.schema.raw("DROP INDEX IF EXISTS idx_events_type_ledger");
  }
};

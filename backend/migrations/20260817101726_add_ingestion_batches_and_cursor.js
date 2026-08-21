/**
 * Migration: Add ingestion_batches table and improve deduplication
 *
 * This migration adds:
 * 1. ingestion_batches table to track which ledger ranges were processed
 * 2. Adds columns for transaction hash and operation index
 * 3. Adds a unique constraint for better deduplication
 * 4. Adds index on ledger_sequence for fast queries
 */

exports.up = async function (knex) {
  // ─── 1. Create ingestion_batches table ────────────────────────────────
  await knex.schema.createTable("ingestion_batches", (table) => {
    table.increments("id").primary();
    table.bigInteger("start_ledger").notNullable();
    table.bigInteger("end_ledger").notNullable();
    table.string("cursor", 255).notNullable().unique();
    table.integer("event_count").defaultTo(0);
    table.json("metadata").defaultTo("{}");
    table.timestamp("processed_at").defaultTo(knex.fn.now());
    table.timestamp("created_at").defaultTo(knex.fn.now());

    table.index(["start_ledger", "end_ledger"]);
    table.index("cursor");
    table.index("processed_at");
  });

  // ─── 2. Add columns for better deduplication ──────────────────────────
  const hasTxnHash = await knex.schema.hasColumn("contract_events", "txn_hash");
  const hasOpIndex = await knex.schema.hasColumn("contract_events", "op_index");

  if (!hasTxnHash) {
    await knex.schema.alterTable("contract_events", (t) => {
      t.string("txn_hash", 64).nullable();
    });
  }

  if (!hasOpIndex) {
    await knex.schema.alterTable("contract_events", (t) => {
      t.integer("op_index").nullable();
    });
  }

  // ─── 3. Improve deduplication for SQLite ──────────────────────────────
  // Drop the old unique index if it exists
  try {
    await knex.schema.raw("DROP INDEX IF EXISTS contract_events_dedup");
  } catch (err) {
    // Index might not exist, continue
  }

  // Create new unique constraint for SQLite
  // SQLite doesn't support functions in indexes, so we use a simpler approach
  await knex.schema.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_contract_events_unique
    ON contract_events (
      ledger_sequence,
      COALESCE(txn_hash, ''),
      COALESCE(op_index, -1),
      event_type
    )
  `);

  // ─── 4. Add index for fast cursor queries ─────────────────────────────
  await knex.schema.alterTable("contract_events", (t) => {
    t.index("ledger_sequence", "idx_events_ledger_sequence");
  });

  // ─── 5. Add index for txn_hash lookups ────────────────────────────────
  await knex.schema.alterTable("contract_events", (t) => {
    t.index("txn_hash", "idx_events_txn_hash");
  });
};

exports.down = async function (knex) {
  // Drop ingestion_batches table
  await knex.schema.dropTableIfExists("ingestion_batches");

  // Drop indexes
  await knex.schema.raw("DROP INDEX IF EXISTS idx_contract_events_unique");
  await knex.schema.raw("DROP INDEX IF EXISTS idx_events_ledger_sequence");
  await knex.schema.raw("DROP INDEX IF EXISTS idx_events_txn_hash");

  // Remove columns if they exist
  const hasTxnHash = await knex.schema.hasColumn("contract_events", "txn_hash");
  const hasOpIndex = await knex.schema.hasColumn("contract_events", "op_index");

  if (hasTxnHash || hasOpIndex) {
    await knex.schema.alterTable("contract_events", (t) => {
      if (hasTxnHash) t.dropColumn("txn_hash");
      if (hasOpIndex) t.dropColumn("op_index");
    });
  }

  // Restore the old unique index (simplified version)
  await knex.schema.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS contract_events_dedup
    ON contract_events (ledger_sequence, contract_id, event_type)
  `);
};

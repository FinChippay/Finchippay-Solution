/**
 * Migration 024: Ensure tips table is Postgres-friendly and add stroop/metadata columns.
 *
 * Adds columns if they do not already exist so the migration is safe to run on
 * existing development databases that already have the legacy schema. Uses
 * knex's cross-dialect columnInfo() + alterTable so it works on both SQLite
 * (dev/test) and Postgres (production/CI).
 */

exports.up = async function (knex) {
  const exists = await knex.schema.hasTable("tips");
  if (!exists) {
    return knex.schema.createTable("tips", (table) => {
      table.increments("id").primary();
      table.string("from_addr").notNullable();
      table.string("to_addr").notNullable();
      table.bigInteger("amount_stroops").notNullable();
      table.string("token_code").notNullable().defaultTo("XLM");
      table.integer("ledger_sequence");
      table.text("memo");
      table.string("transaction_hash");
      table.timestamp("created_at").defaultTo(knex.fn.now());
      table.index("from_addr");
      table.index("to_addr");
      table.index("created_at");
    });
  }

  // For existing tables: add columns only if missing (cross-dialect).
  const info = await knex("tips").columnInfo();
  const addIfMissing = async (name, fn) => {
    if (!(name in info)) {
      await knex.schema.alterTable("tips", fn);
    }
  };

  await addIfMissing("from_addr", (t) => t.string("from_addr", 56).nullable());
  await addIfMissing("to_addr", (t) => t.string("to_addr", 56).nullable());
  await addIfMissing("amount_stroops", (t) => t.bigInteger("amount_stroops").nullable());
  await addIfMissing("token_code", (t) => t.string("token_code", 12).defaultTo("XLM"));
  await addIfMissing("ledger_sequence", (t) => t.integer("ledger_sequence").nullable());
  await addIfMissing("memo", (t) => t.text("memo").nullable());
  await addIfMissing("transaction_hash", (t) => t.string("transaction_hash", 128).nullable());
  await addIfMissing("created_at", (t) => t.timestamp("created_at").defaultTo(knex.fn.now()));

  // CREATE INDEX IF NOT EXISTS is supported on both SQLite and Postgres.
  await knex.schema.raw("CREATE INDEX IF NOT EXISTS idx_tips_from ON tips(from_addr)");
  await knex.schema.raw("CREATE INDEX IF NOT EXISTS idx_tips_to ON tips(to_addr)");
  await knex.schema.raw("CREATE INDEX IF NOT EXISTS idx_tips_created ON tips(created_at)");
};

exports.down = async function (knex) {
  // Remove the columns if they exist. Do not drop the legacy `tips` table
  // unconditionally because it may contain seeded development data.
  const info = await knex("tips").columnInfo();
  const dropIfPresent = async (name, fn) => {
    if (name in info) {
      await knex.schema.alterTable("tips", fn);
    }
  };

  await dropIfPresent("from_addr", (t) => t.dropColumn("from_addr"));
  await dropIfPresent("to_addr", (t) => t.dropColumn("to_addr"));
  await dropIfPresent("amount_stroops", (t) => t.dropColumn("amount_stroops"));
  await dropIfPresent("token_code", (t) => t.dropColumn("token_code"));
  await dropIfPresent("ledger_sequence", (t) => t.dropColumn("ledger_sequence"));
  await dropIfPresent("memo", (t) => t.dropColumn("memo"));
  await dropIfPresent("transaction_hash", (t) => t.dropColumn("transaction_hash"));
  await dropIfPresent("created_at", (t) => t.dropColumn("created_at"));

  await knex.schema.raw("DROP INDEX IF EXISTS idx_tips_from");
  await knex.schema.raw("DROP INDEX IF EXISTS idx_tips_to");
  await knex.schema.raw("DROP INDEX IF EXISTS idx_tips_created");
};

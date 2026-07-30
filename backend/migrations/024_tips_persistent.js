/**
 * Migration 024: Ensure tips table is Postgres-friendly and add stroop/metadata columns.
 *
 * Adds columns if they do not already exist so the migration is safe to run on
 * existing development databases that already have the legacy schema.
 */

exports.up = function (knex) {
  return knex.schema.hasTable("tips").then((exists) => {
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

    // For existing tables: add columns using Postgres-safe ALTERs (IF NOT EXISTS).
    // knex's schema API doesn't expose "add column if not exists" across all
    // dialects, so use raw SQL which works on Postgres (CI target).
    const stmts = [
      `ALTER TABLE tips ADD COLUMN IF NOT EXISTS from_addr VARCHAR(56);`,
      `ALTER TABLE tips ADD COLUMN IF NOT EXISTS to_addr VARCHAR(56);`,
      `ALTER TABLE tips ADD COLUMN IF NOT EXISTS amount_stroops BIGINT;`,
      `ALTER TABLE tips ADD COLUMN IF NOT EXISTS token_code VARCHAR(12) DEFAULT 'XLM';`,
      `ALTER TABLE tips ADD COLUMN IF NOT EXISTS ledger_sequence INTEGER;`,
      `ALTER TABLE tips ADD COLUMN IF NOT EXISTS memo TEXT;`,
      `ALTER TABLE tips ADD COLUMN IF NOT EXISTS transaction_hash VARCHAR(128);`,
      `ALTER TABLE tips ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();`,
      `CREATE INDEX IF NOT EXISTS idx_tips_from ON tips(from_addr);`,
      `CREATE INDEX IF NOT EXISTS idx_tips_to ON tips(to_addr);`,
      `CREATE INDEX IF NOT EXISTS idx_tips_created ON tips(created_at);`,
    ];

    return Promise.all(stmts.map((s) => knex.raw(s)));
  });
};

exports.down = function (knex) {
  // Remove the columns if they exist. Do not drop the legacy `tips` table
  // unconditionally because it may contain seeded development data.
  const drops = [
    `ALTER TABLE tips DROP COLUMN IF EXISTS from_addr;`,
    `ALTER TABLE tips DROP COLUMN IF EXISTS to_addr;`,
    `ALTER TABLE tips DROP COLUMN IF EXISTS amount_stroops;`,
    `ALTER TABLE tips DROP COLUMN IF EXISTS token_code;`,
    `ALTER TABLE tips DROP COLUMN IF EXISTS ledger_sequence;`,
    `ALTER TABLE tips DROP COLUMN IF EXISTS memo;`,
    `ALTER TABLE tips DROP COLUMN IF EXISTS transaction_hash;`,
    `ALTER INDEX IF EXISTS idx_tips_from;`,
    `ALTER INDEX IF EXISTS idx_tips_to;`,
    `ALTER INDEX IF EXISTS idx_tips_created;`,
  ];

  return Promise.all(drops.map((s) => knex.raw(s)));
};
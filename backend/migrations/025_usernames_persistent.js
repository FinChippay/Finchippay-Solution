/**
 * Migration 025: Ensure usernames table includes profile fields and timestamps.
 *
 * Adds columns if they do not already exist so the migration is safe to run on
 * existing development databases that already have the legacy schema.
 */

exports.up = function (knex) {
  return knex.schema.hasTable("usernames").then((exists) => {
    if (!exists) {
      return knex.schema.createTable("usernames", (table) => {
        table.increments("id").primary();
        table.string("username").unique().notNullable();
        table.string("public_key").unique().notNullable();
        table.string("display_name");
        table.text("avatar_url");
        table.text("bio");
        table.timestamp("created_at").defaultTo(knex.fn.now());
        table.timestamp("updated_at").defaultTo(knex.fn.now());
        table.index("public_key");
        table.index("username");
      });
    }

    const stmts = [
      `ALTER TABLE usernames ADD COLUMN IF NOT EXISTS display_name VARCHAR(100);`,
      `ALTER TABLE usernames ADD COLUMN IF NOT EXISTS avatar_url TEXT;`,
      `ALTER TABLE usernames ADD COLUMN IF NOT EXISTS bio TEXT;`,
      `ALTER TABLE usernames ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();`,
      `ALTER TABLE usernames ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();`,
      `CREATE INDEX IF NOT EXISTS idx_usernames_public_key ON usernames(public_key);`,
      `CREATE INDEX IF NOT EXISTS idx_usernames_lookup ON usernames(username);`,
    ];

    return Promise.all(stmts.map((s) => knex.raw(s)));
  });
};

exports.down = function (knex) {
  const drops = [
    `ALTER TABLE usernames DROP COLUMN IF EXISTS display_name;`,
    `ALTER TABLE usernames DROP COLUMN IF EXISTS avatar_url;`,
    `ALTER TABLE usernames DROP COLUMN IF EXISTS bio;`,
    `ALTER TABLE usernames DROP COLUMN IF EXISTS created_at;`,
    `ALTER TABLE usernames DROP COLUMN IF EXISTS updated_at;`,
    `ALTER INDEX IF EXISTS idx_usernames_public_key;`,
    `ALTER INDEX IF EXISTS idx_usernames_lookup;`,
  ];

  return Promise.all(drops.map((s) => knex.raw(s)));
};
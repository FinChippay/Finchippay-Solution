/**
 * Migration 025: Ensure usernames table includes profile fields and timestamps.
 *
 * Adds columns if they do not already exist so the migration is safe to run on
 * existing development databases that already have the legacy schema. Uses
 * knex's cross-dialect columnInfo() + alterTable so it works on both SQLite
 * (dev/test) and Postgres (production/CI).
 */

exports.up = async function (knex) {
  const exists = await knex.schema.hasTable("usernames");
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

  // For existing tables: add columns only if missing (cross-dialect).
  const info = await knex("usernames").columnInfo();
  const addIfMissing = async (name, fn) => {
    if (!(name in info)) {
      await knex.schema.alterTable("usernames", fn);
    }
  };

  await addIfMissing("display_name", (t) => t.string("display_name", 100).nullable());
  await addIfMissing("avatar_url", (t) => t.text("avatar_url").nullable());
  await addIfMissing("bio", (t) => t.text("bio").nullable());
  await addIfMissing("created_at", (t) => t.timestamp("created_at").defaultTo(knex.fn.now()));
  await addIfMissing("updated_at", (t) => t.timestamp("updated_at").defaultTo(knex.fn.now()));

  // CREATE INDEX IF NOT EXISTS is supported on both SQLite and Postgres.
  await knex.schema.raw(
    "CREATE INDEX IF NOT EXISTS idx_usernames_public_key ON usernames(public_key)",
  );
  await knex.schema.raw("CREATE INDEX IF NOT EXISTS idx_usernames_lookup ON usernames(username)");
};

exports.down = async function (knex) {
  const info = await knex("usernames").columnInfo();
  const dropIfPresent = async (name, fn) => {
    if (name in info) {
      await knex.schema.alterTable("usernames", fn);
    }
  };

  await dropIfPresent("display_name", (t) => t.dropColumn("display_name"));
  await dropIfPresent("avatar_url", (t) => t.dropColumn("avatar_url"));
  await dropIfPresent("bio", (t) => t.dropColumn("bio"));
  await dropIfPresent("created_at", (t) => t.dropColumn("created_at"));
  await dropIfPresent("updated_at", (t) => t.dropColumn("updated_at"));

  await knex.schema.raw("DROP INDEX IF EXISTS idx_usernames_public_key");
  await knex.schema.raw("DROP INDEX IF EXISTS idx_usernames_lookup");
};

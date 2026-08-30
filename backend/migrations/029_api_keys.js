"use strict";

exports.up = async function (knex) {
  if (await knex.schema.hasTable("api_keys")) return;

  await knex.schema.createTable("api_keys", (table) => {
    table.increments("id").primary();
    table.string("public_key", 56).notNullable();
    table.string("key_hash", 64).notNullable().unique();
    table.string("key_prefix", 12).notNullable();
    table.text("scopes", "text").notNullable();
    table.boolean("revoked").notNullable().defaultTo(false);
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    table.timestamp("revoked_at");
    table.timestamp("last_used_at");
    table.index("public_key", "idx_api_keys_public_key");
    table.index(["key_hash", "revoked"], "idx_api_keys_hash_revoked");
  });
};

exports.down = function (knex) {
  return knex.schema.dropTableIfExists("api_keys");
};

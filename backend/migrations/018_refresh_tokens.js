/**
 * backend/migrations/018_refresh_tokens.js
 * Migration creating refresh_tokens table for SEP-0010 token rotation & session management.
 */
"use strict";

exports.up = async function (knex) {
  const exists = await knex.schema.hasTable("refresh_tokens");
  if (!exists) {
    await knex.schema.createTable("refresh_tokens", (table) => {
      table.increments("id").primary();
      table.string("public_key", 56).notNullable();
      table.string("token_hash", 64).notNullable().unique();
      table.text("device_info");
      table.string("ip_address");
      table.timestamp("expires_at").notNullable();
      table.boolean("revoked").defaultTo(false);
      table.timestamp("created_at").defaultTo(knex.fn.now());
      table.timestamp("last_used_at");

      table.index("public_key", "idx_refresh_tokens_public_key");
      table.index("token_hash", "idx_refresh_tokens_hash");
    });
  }
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists("refresh_tokens");
};

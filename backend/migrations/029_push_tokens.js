/**
 * Migration 029: Create push_tokens table.
 *
 * Stores native mobile device tokens (FCM / APNs) so the backend can target
 * installed apps. One row per token; an account may register several devices
 * up to the per-account cap enforced in pushService.
 */

"use strict";

exports.up = async function (knex) {
  await knex.schema.createTable("push_tokens", (table) => {
    table.increments("id").primary();
    table.string("public_key").notNullable();
    table.text("token").notNullable();
    table.string("provider", 8).notNullable().comment("fcm or apns");
    table.timestamp("created_at").defaultTo(knex.fn.now());
    table.timestamp("last_used_at");

    table.index("public_key", "idx_push_tokens_public_key");
  });

  await knex.schema.raw(`CREATE UNIQUE INDEX idx_push_tokens_token ON push_tokens (token)`);
};

exports.down = function (knex) {
  return knex.schema.dropTableIfExists("push_tokens");
};

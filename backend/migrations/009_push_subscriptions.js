/**
 * Migration 009: Create push_subscriptions table.
 *
 * Stores Web Push subscriptions so the backend can notify a user's devices
 * while the PWA is closed (payment received, stream claimable, escrow
 * unlocked). One row per browser endpoint; a user may have several.
 *
 * The issue text asks for a raw .sql file under src/db/migrations, but
 * migration 008 records that raw .sql files were never executed by Knex.
 * This follows the Knex convention instead so `npm run migrate` provisions
 * the table and `npm run migrate:status` stays clean in CI.
 */

"use strict";

exports.up = async function (knex) {
  await knex.schema.createTable("push_subscriptions", (table) => {
    table.increments("id").primary();

    // Stellar account the subscription belongs to.
    table.string("public_key").notNullable();

    // Push service URL identifying this browser/device. Long enough to need
    // text rather than string, and unique: one endpoint is one device.
    table.text("endpoint").notNullable();

    // Encryption material from PushSubscription.toJSON().keys.
    table.string("p256dh").notNullable();
    table.string("auth").notNullable();

    table.timestamp("created_at").defaultTo(knex.fn.now());

    // Bumped on each successful send, so dead devices are identifiable.
    table.timestamp("last_used_at");

    table.index("public_key", "idx_push_subscriptions_public_key");
  });

  // Unique on endpoint alone rather than (public_key, endpoint): if a second
  // account subscribes from the same browser, the row is reassigned instead
  // of leaving the previous account receiving that device's notifications.
  await knex.schema.raw(
    `CREATE UNIQUE INDEX idx_push_subscriptions_endpoint
       ON push_subscriptions (endpoint)`,
  );
};

exports.down = function (knex) {
  return knex.schema.dropTableIfExists("push_subscriptions");
};

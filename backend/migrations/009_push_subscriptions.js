/**
 * Migration 009: Create push_subscriptions table.
 *
 * Stores Web Push subscriptions per Stellar public key so the backend
 * can send push notifications to subscribed browsers.
 */

exports.up = function (knex) {
  return knex.schema.createTable("push_subscriptions", (table) => {
    table.increments("id").primary();
    // Stellar public key of the subscribed user
    table.string("public_key").notNullable();
    // Browser push endpoint URL (unique per browser session)
    table.string("endpoint").notNullable();
    // VAPID encryption keys provided by the browser's PushManager
    table.string("p256dh").nullable();
    table.string("auth").nullable();

    table.timestamp("created_at").defaultTo(knex.fn.now());
    table.timestamp("updated_at").defaultTo(knex.fn.now());

    // One subscription per (user, endpoint) pair
    table.unique(["public_key", "endpoint"]);
    // Fast lookups by public key when sending notifications
    table.index("public_key");
  });
};

exports.down = function (knex) {
  return knex.schema.dropTableIfExists("push_subscriptions");
};

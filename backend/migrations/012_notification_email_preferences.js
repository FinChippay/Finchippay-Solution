/**
 * Migration 012: Create notification_email_preferences table.
 *
 * Stores email notification preferences per Stellar public key.
 * Users can register an email address and select which event
 * types trigger email notifications.
 */

exports.up = function (knex) {
  return knex.schema.createTable("notification_email_preferences", (table) => {
    table.string("public_key").primary();
    table.string("email").notNullable();
    table.text("events").notNullable().defaultTo("[]");
    table.timestamp("created_at").defaultTo(knex.fn.now());
    table.timestamp("updated_at").defaultTo(knex.fn.now());
  });
};

exports.down = function (knex) {
  return knex.schema.dropTableIfExists("notification_email_preferences");
};

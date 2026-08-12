/**
 * Migration 015: Notification Preferences
 *
 * Unified notification preferences table supporting per-event-type channel
 * toggles, global quiet hours, and a notification history table.
 */

"use strict";

exports.up = function (knex) {
  return knex.schema
    .createTable("notification_preferences", (table) => {
      table.increments("id").primary();
      table.string("public_key", 56).notNullable().unique().comment("Stellar account G… address");
      table
        .jsonb("event_channels")
        .defaultTo("{}")
        .comment("JSON map: { event_type: { push: bool, email: bool, in_app: bool } }");
      table
        .boolean("quiet_hours_enabled")
        .defaultTo(false)
        .comment("Whether quiet hours are active");
      table
        .string("quiet_hours_start", 5)
        .defaultTo("22:00")
        .comment("Quiet hours start time (HH:mm)");
      table.string("quiet_hours_end", 5).defaultTo("07:00").comment("Quiet hours end time (HH:mm)");
      table.string("timezone", 64).defaultTo("UTC").comment("User timezone (IANA tz database)");
      table.boolean("push_enabled").defaultTo(true).comment("Master push channel toggle");
      table.boolean("email_enabled").defaultTo(true).comment("Master email channel toggle");
      table.boolean("in_app_enabled").defaultTo(true).comment("Master in-app channel toggle");
      table.timestamp("created_at").defaultTo(knex.fn.now());
      table.timestamp("updated_at").defaultTo(knex.fn.now());
    })
    .createTable("notification_history", (table) => {
      table.increments("id").primary();
      table.string("public_key", 56).notNullable();
      table.string("event_type", 64).notNullable().comment("Type of notification event");
      table.text("message").notNullable().comment("Notification body text");
      table.string("channel", 16).notNullable().comment("Delivery channel: push, email, in_app");
      table.boolean("read").defaultTo(false).comment("Whether the notification has been read");
      table.timestamp("created_at").defaultTo(knex.fn.now());
      table.index(["public_key", "created_at"], "idx_notif_history_pk_created");
      table.index(["public_key", "read"], "idx_notif_history_pk_read");
    });
};

exports.down = function (knex) {
  return knex.schema
    .dropTableIfExists("notification_history")
    .dropTableIfExists("notification_preferences");
};

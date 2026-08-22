/**
 * Migration 021: Email Events, Send Queue, and Unsubscribes
 *
 * Creates tables for:
 * - email_events: delivery/open/click/bounce tracking per email
 * - email_send_queue: async send queue with retry support
 * - email_unsubscribes: per-email/per-category unsubscribe records
 */

"use strict";

exports.up = function (knex) {
  return knex.schema
    .createTable("email_events", (table) => {
      table.increments("id").primary();
      table.string("email_id", 64).notNullable().comment("Unique tracking ID per sent email");
      table.string("event_type", 32).notNullable().comment("sent|delivered|opened|clicked|bounced|complained");
      table.timestamp("timestamp").defaultTo(knex.fn.now());
      table.string("user_agent", 512).nullable();
      table.string("ip", 64).nullable();
      table.text("metadata").nullable().comment("JSON extra data (bounce reason, click URL, etc.)");
      table.index(["email_id"], "idx_email_events_email_id");
      table.index(["event_type", "timestamp"], "idx_email_events_type_ts");
    })
    .createTable("email_send_queue", (table) => {
      table.increments("id").primary();
      table.string("email_id", 64).notNullable().unique().comment("Unique ID for tracking");
      table.string("to_address", 320).notNullable();
      table.string("subject", 512).notNullable();
      table.text("html").notNullable();
      table.text("text").nullable();
      table.string("template_type", 64).nullable();
      table.text("template_data").nullable().comment("JSON context used for rendering");
      table.string("status", 32).notNullable().defaultTo("pending").comment("pending|sent|failed|cancelled");
      table.integer("attempts").defaultTo(0);
      table.integer("max_attempts").defaultTo(3);
      table.timestamp("next_attempt_at").defaultTo(knex.fn.now());
      table.text("last_error").nullable();
      table.string("public_key", 56).nullable().comment("Associated Stellar public key");
      table.timestamp("created_at").defaultTo(knex.fn.now());
      table.timestamp("updated_at").defaultTo(knex.fn.now());
      table.index(["status", "next_attempt_at"], "idx_email_queue_status_next");
      table.index(["public_key"], "idx_email_queue_pk");
    })
    .createTable("email_unsubscribes", (table) => {
      table.increments("id").primary();
      table.string("email", 320).notNullable();
      table.string("category", 64).notNullable().defaultTo("all").comment("all or specific event category");
      table.timestamp("unsubscribed_at").defaultTo(knex.fn.now());
      table.string("reason", 255).nullable();
      table.string("token", 128).notNullable().unique().comment("One-click unsubscribe token");
      table.unique(["email", "category"], "uq_email_unsubscribes_email_category");
      table.index(["email"], "idx_email_unsubscribes_email");
      table.index(["token"], "idx_email_unsubscribes_token");
    })
    .createTable("email_verification_tokens", (table) => {
      table.increments("id").primary();
      table.string("public_key", 56).notNullable();
      table.string("email", 320).notNullable();
      table.string("token", 128).notNullable().unique();
      table.boolean("verified").defaultTo(false);
      table.timestamp("expires_at").notNullable();
      table.timestamp("verified_at").nullable();
      table.timestamp("created_at").defaultTo(knex.fn.now());
      table.index(["public_key"], "idx_email_verify_pk");
      table.index(["token"], "idx_email_verify_token");
    });
};

exports.down = function (knex) {
  return knex.schema
    .dropTableIfExists("email_verification_tokens")
    .dropTableIfExists("email_unsubscribes")
    .dropTableIfExists("email_send_queue")
    .dropTableIfExists("email_events");
};

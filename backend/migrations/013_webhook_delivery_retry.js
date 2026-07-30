/**
 * Migration 013: Webhook delivery retry with exponential backoff support.
 *
 * Adds columns to webhook_deliveries for priority ordering and last HTTP
 * response tracking, and creates a dedicated dead_letter_queue table
 * (separate from status='dead' rows) storing the full retry timeline and
 * final error for admin review/replay, per issue #494.
 */

exports.up = async function (knex) {
  await knex.schema.alterTable("webhook_deliveries", (table) => {
    table.integer("retry_attempts").defaultTo(0);
    table.integer("last_http_status");
    table.text("last_response_body");
    table.integer("delivery_priority").defaultTo(0);
  });

  await knex.schema.createTable("dead_letter_queue", (table) => {
    table.string("id").primary();
    table
      .string("delivery_id")
      .notNullable()
      .references("id")
      .inTable("webhook_deliveries")
      .onDelete("CASCADE");
    table.string("webhook_id").notNullable();
    table.text("payload").notNullable();
    table.text("retry_timestamps");
    table.text("final_error");
    table.timestamp("created_at").defaultTo(knex.fn.now());

    table.index("webhook_id", "idx_dlq_webhook_id");
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists("dead_letter_queue");
  await knex.schema.alterTable("webhook_deliveries", (table) => {
    table.dropColumn("retry_attempts");
    table.dropColumn("last_http_status");
    table.dropColumn("last_response_body");
    table.dropColumn("delivery_priority");
  });
};

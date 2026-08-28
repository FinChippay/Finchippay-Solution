/**
 * Migration 010: Create webhook_events table.
 *
 * Stores successfully delivered webhook events with idempotency keys
 * to allow for event replay and to protect consumers against double-processing.
 */

exports.up = async function (knex) {
  await knex.schema.createTable("webhook_events", (table) => {
    table.string("id").primary();
    table
      .string("webhook_id")
      .notNullable()
      .references("id")
      .inTable("webhooks")
      .onDelete("CASCADE");
    table.string("event_type").notNullable();
    table.jsonb("payload").notNullable();
    table.string("idempotency_key").notNullable().unique();
    table.timestamp("delivered_at");
    table.timestamp("created_at").defaultTo(knex.fn.now());

    table.index(["webhook_id", "created_at"], "idx_webhook_events_created");
  });

  await knex.schema.alterTable("webhook_deliveries", (table) => {
    table.string("idempotency_key");
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable("webhook_deliveries", (table) => {
    table.dropColumn("idempotency_key");
  });
  return knex.schema.dropTableIfExists("webhook_events");
};

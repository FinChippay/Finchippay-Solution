/**
 * Migration 008: Create webhook_deliveries table.
 *
 * Tracks webhook delivery attempts and retry state for webhookService's
 * retry worker. Previously defined only as a raw .sql file that Knex never
 * executed; ported here so a fresh `npm run migrate` provisions it.
 */

exports.up = async function (knex) {
  await knex.schema.createTable("webhook_deliveries", (table) => {
    table.string("id").primary();
    table.string("webhook_id").notNullable();
    table.string("event_type").notNullable();
    table.text("payload").notNullable();
    table.string("status").defaultTo("pending");
    table.integer("attempts").defaultTo(0);
    table.timestamp("last_attempt_at");
    table.text("last_error");
    table.timestamp("next_retry_at");
    table.timestamp("created_at").defaultTo(knex.fn.now());

    table.index("status", "idx_webhook_deliveries_status");
    table.index("webhook_id", "idx_webhook_deliveries_webhook_id");
  });

  // Partial index over rows awaiting retry. Not expressible via table.index()
  // (needs a WHERE clause); the syntax below is portable across Postgres and
  // SQLite.
  await knex.schema.raw(
    `CREATE INDEX idx_webhook_deliveries_next_retry
       ON webhook_deliveries (next_retry_at)
       WHERE status = 'pending'`,
  );
};

exports.down = function (knex) {
  return knex.schema.dropTableIfExists("webhook_deliveries");
};

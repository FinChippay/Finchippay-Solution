/**
 * Migration 011: Create scheduled_txn_executions table for execution history tracking.
 *
 * Tracks execution attempts, retries, and failures for scheduled transactions.
 * Enables audit logging and retry policy enforcement.
 */

exports.up = async function (knex) {
  await knex.schema.createTable("scheduled_txn_executions", (table) => {
    table.string("id").primary();
    table
      .string("schedule_id")
      .notNullable()
      .references("id")
      .inTable("scheduled_transactions")
      .onDelete("CASCADE");
    table.string("owner_pk").notNullable();
    table.string("status").notNullable(); // pending/submitted/failed
    table.integer("attempt_number").notNullable().defaultTo(1);
    table.string("submitted_hash").nullable(); // Stellar tx hash on success
    table.text("error_message").nullable(); // Error details on failure
    table.string("error_code").nullable(); // e.g., INSUFFICIENT_BALANCE, TIMEOUT
    table.timestamp("executed_at").notNullable().defaultTo(knex.fn.now());
    table.timestamp("next_retry_at").nullable(); // When to retry if failed
    table.timestamp("resolved_at").nullable(); // When final status determined
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());

    // Indexes for querying
    table.index("schedule_id", "idx_txn_executions_schedule");
    table.index("owner_pk", "idx_txn_executions_owner");
    table.index("status", "idx_txn_executions_status");
    table.index("attempt_number", "idx_txn_executions_attempt");
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists("scheduled_txn_executions");
};

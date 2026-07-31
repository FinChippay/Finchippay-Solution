/**
 * Migration 007: Create scheduled_transactions and pending_executions tables.
 *
 * Backs the recurring/scheduled payment feature (scheduledTransactionService).
 * Previously defined only as a raw .sql file that Knex never executed; ported
 * here so a fresh `npm run migrate` provisions these tables.
 */

exports.up = async function (knex) {
  await knex.schema.createTable("scheduled_transactions", (table) => {
    table.string("id").primary();
    table.string("owner_pk").notNullable();
    table.string("recipient").notNullable();
    table.string("amount").notNullable();
    table.string("asset").defaultTo("XLM");
    table.text("memo");
    table.string("frequency").notNullable();
    table.string("cron_expression");
    table.date("start_date").notNullable();
    table.timestamp("next_run_at");
    table.string("status").defaultTo("active");
    table.timestamp("created_at").defaultTo(knex.fn.now());

    table.index("owner_pk", "idx_scheduled_transactions_owner");
    table.index("status", "idx_scheduled_transactions_status");
  });

  await knex.schema.createTable("pending_executions", (table) => {
    table.string("id").primary();
    table
      .string("schedule_id")
      .notNullable()
      .references("id")
      .inTable("scheduled_transactions")
      .onDelete("CASCADE");
    table.string("owner_pk").notNullable();
    table.text("unsigned_xdr").notNullable();
    table.string("status").notNullable().defaultTo("awaiting_signature");
    table.string("submitted_hash");
    table.text("error");
    table.timestamp("created_at").defaultTo(knex.fn.now());
    table.timestamp("resolved_at");

    table.index("owner_pk", "idx_pending_executions_owner");
    table.index("schedule_id", "idx_pending_executions_schedule");
  });
};

exports.down = async function (knex) {
  // Drop the child table first to satisfy the foreign key.
  await knex.schema.dropTableIfExists("pending_executions");
  await knex.schema.dropTableIfExists("scheduled_transactions");
};

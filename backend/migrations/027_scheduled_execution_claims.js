/**
 * Migration 027: Add execution claim/lease columns to scheduled_txn_executions.
 *
 * Backs the scheduled executor's single-execution guarantee (#632). An
 * execution row is claimed (`execution_status = 'claimed'`) with a lease
 * (`lease_expires_at`) before its side effect runs; the lease lets a crashed
 * worker's claim be reclaimed by another worker after it expires.
 */

"use strict";

exports.up = function (knex) {
  return knex.schema.table("scheduled_txn_executions", (table) => {
    table
      .string("execution_status")
      .nullable()
      .comment("Claim lifecycle: claimed → executed/failed; NULL = unclaimed");
    table
      .timestamp("lease_expires_at")
      .nullable()
      .comment("When the execution claim lease expires (for crash recovery)");
  });
};

exports.down = function (knex) {
  return knex.schema.table("scheduled_txn_executions", (table) => {
    table.dropColumn("lease_expires_at");
    table.dropColumn("execution_status");
  });
};

/**
 * Migration 030: Add claim/lock columns to email_send_queue.
 *
 * Backs the email queue's single-send guarantee (see notificationService.js
 * processEmailQueue). A row is atomically claimed (status -> 'processing',
 * locked_by/locked_at set) before sendEmail runs; locked_at lets a crashed
 * worker's claim be reclaimed by another worker once it goes stale.
 */

"use strict";

exports.up = function (knex) {
  return knex.schema.table("email_send_queue", (table) => {
    table
      .string("locked_by", 128)
      .nullable()
      .comment("Worker id that currently owns this row (claim owner)");
    table
      .timestamp("locked_at")
      .nullable()
      .comment("When the row was claimed; used to detect/reclaim stale processing rows");
    table.index(["status", "locked_at"], "idx_email_queue_status_locked");
  });
};

exports.down = function (knex) {
  return knex.schema.table("email_send_queue", (table) => {
    table.dropIndex(["status", "locked_at"], "idx_email_queue_status_locked");
    table.dropColumn("locked_at");
    table.dropColumn("locked_by");
  });
};

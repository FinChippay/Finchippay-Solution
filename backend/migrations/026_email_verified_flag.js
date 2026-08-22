/**
 * Migration 026: Add email_verified column to notification_email_preferences.
 *
 * Email notifications are only sent to verified addresses (Issue #491).
 */

"use strict";

exports.up = function (knex) {
  return knex.schema.table("notification_email_preferences", (table) => {
    table.boolean("email_verified").defaultTo(false).comment("Whether the email address has been verified");
  });
};

exports.down = function (knex) {
  return knex.schema.table("notification_email_preferences", (table) => {
    table.dropColumn("email_verified");
  });
};

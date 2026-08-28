"use strict";

/**
 * Migration 011: Persist webhook subscription topics.
 *
 * Topics are stored as a JSON array in a text column so the schema behaves the
 * same on SQLite and PostgreSQL. Existing registrations remain backward
 * compatible through the ["all"] default.
 */
exports.up = async function (knex) {
  const hasTopics = await knex.schema.hasColumn("webhooks", "topics");
  if (hasTopics) return;

  await knex.schema.alterTable("webhooks", (table) => {
    table.text("topics").notNullable().defaultTo('["all"]');
  });
};

exports.down = async function (knex) {
  const hasTopics = await knex.schema.hasColumn("webhooks", "topics");
  if (!hasTopics) return;

  await knex.schema.alterTable("webhooks", (table) => {
    table.dropColumn("topics");
  });
};

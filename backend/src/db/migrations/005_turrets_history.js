/**
 * Migration 005: Create turrets_history table.
 *
 * Stores Turrets txFunction execution history.
 */

exports.up = function (knex) {
  return knex.schema.createTable("turrets_history", (table) => {
    table.string("id").primary();
    table
      .string("deployment_id")
      .notNullable()
      .references("id")
      .inTable("turrets_deployments");
    table.string("status").notNullable();
    table.text("message");
    table.text("result"); // JSON stringified
    table.timestamp("created_at").defaultTo(knex.fn.now());
    table.index("deployment_id");
  });
};

exports.down = function (knex) {
  return knex.schema.dropTableIfExists("turrets_history");
};

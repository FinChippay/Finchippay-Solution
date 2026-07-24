/**
 * Migration 004: Create turrets_deployments table.
 *
 * Stores Turrets txFunction deployment configurations.
 */

exports.up = function (knex) {
  return knex.schema.createTable("turrets_deployments", (table) => {
    table.string("id").primary();
    table.string("owner_pk").notNullable();
    table.string("type").notNullable();
    table.string("status").notNullable().defaultTo("active");
    table.text("config").notNullable(); // JSON stringified
    table.string("deployment_hash");
    table.text("signed_challenge_xdr");
    table.timestamp("created_at").defaultTo(knex.fn.now());
    table.bigInteger("created_at_ms");
    table.timestamp("next_run_at");
    table.timestamp("last_executed_at");
    table.timestamp("last_checked_at");
    table.float("last_observed_price_usd");
    table.text("last_error");
    table.index("owner_pk");
    table.index("status");
  });
};

exports.down = function (knex) {
  return knex.schema.dropTableIfExists("turrets_deployments");
};

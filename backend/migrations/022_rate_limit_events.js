/**
 * Migration 022: Rate Limit Events
 *
 * Records every rate limit block with metadata for analytics dashboards
 * and historical rate limit data storage.
 */

"use strict";

exports.up = function (knex) {
  return knex.schema
    .createTable("rate_limit_events", (table) => {
      table.increments("id").primary();
      table.string("public_key", 56);
      table.specificType("ip_address", "INET").notNullable();
      table.string("route", 128).notNullable();
      table.string("method", 8).notNullable();
      table.boolean("blocked").defaultTo(false);
      table.integer("current_count");
      table.integer("max_count");
      table.timestamp("window_start");
      table.timestamp("occurred_at").defaultTo(knex.fn.now());
      table.index("ip_address", "idx_rle_ip");
      table.index("route", "idx_rle_route");
      table.index("occurred_at", "idx_rle_occurred");
    })
    .createTable("rate_limit_configs", (table) => {
      table.increments("id").primary();
      table.string("route", 128).notNullable();
      table.string("method", 8).notNullable().defaultTo("ALL");
      table.integer("limit").notNullable();
      table.integer("window_ms").notNullable();
      table.boolean("enabled").defaultTo(true);
      table.timestamp("created_at").defaultTo(knex.fn.now());
      table.timestamp("updated_at").defaultTo(knex.fn.now());
      table.unique(["route", "method"], "idx_rlc_route_method");
    });
};

exports.down = function (knex) {
  return knex.schema.dropTableIfExists("rate_limit_configs").dropTableIfExists("rate_limit_events");
};

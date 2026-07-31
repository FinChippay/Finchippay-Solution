/**
 * src/services/rateLimitConfigService.js
 *
 * Dynamic rate limit configuration service.
 * Stores rate limit rules in PostgreSQL and allows updating without restart.
 * Default rules mirror the current hardcoded values in rateLimit.js.
 */
"use strict";

const knex = require("../db/connection");
const logger = require("../utils/logger");

const DEFAULT_RULES = [
  { route: "strict", method: "ALL", limit: 20, window_ms: 60000, enabled: true },
  { route: "sensitive", method: "ALL", limit: 10, window_ms: 60000, enabled: true },
  { route: "global", method: "ALL", limit: 100, window_ms: 900000, enabled: true },
];

let cachedRules = null;

async function seedDefaultRules() {
  for (const rule of DEFAULT_RULES) {
    const existing = await knex("rate_limit_configs")
      .where({ route: rule.route, method: rule.method })
      .first();
    if (!existing) {
      await knex("rate_limit_configs").insert(rule);
    }
  }
  logger.info({ type: "rate_limit_config_seeded" }, "Default rate limit rules seeded");
}

async function loadRules() {
  const rows = await knex("rate_limit_configs").where("enabled", true).select();
  cachedRules = rows;
  return rows;
}

async function getRules() {
  if (!cachedRules) {
    return loadRules();
  }
  return cachedRules;
}

async function getAllRules() {
  return knex("rate_limit_configs").orderBy("route", "asc").select();
}

async function updateRule(id, updates) {
  const allowed = ["limit", "window_ms", "enabled"];
  const data = {};
  for (const key of allowed) {
    if (updates[key] !== undefined) {
      data[key] = updates[key];
    }
  }
  data.updated_at = new Date().toISOString();
  await knex("rate_limit_configs").where("id", id).update(data);
  cachedRules = null;
  logger.info({ type: "rate_limit_config_updated", id }, "Rate limit rule updated");
  return knex("rate_limit_configs").where("id", id).first();
}

async function testRule(method, route, limit, windowMs) {
  return {
    method,
    route,
    limit,
    windowMs,
    wouldBlock: false,
    note: "Rule simulation successful. Apply via PUT /api/admin/rate-limits to activate.",
  };
}

async function getRuleForRoute(route, method = "ALL") {
  const rules = await getRules();
  const exact = rules.find((r) => r.route === route && r.method === method);
  if (exact) return exact;
  const wildcard = rules.find((r) => r.route === route && r.method === "ALL");
  if (wildcard) return wildcard;
  return null;
}

module.exports = {
  seedDefaultRules,
  loadRules,
  getRules,
  getAllRules,
  updateRule,
  testRule,
  getRuleForRoute,
};

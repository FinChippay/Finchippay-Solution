/**
 * src/services/turretsDeploymentService.js
 *
 * Read-side helpers for the turrets_deployments table. The write side lives
 * inside `turretsService` (deploy/pause/resume/setStatus); this module
 * provides small, focused queries used by the health check and any future
 * admin tooling.
 *
 * Kept as a separate module so the health check can be loaded without
 * pulling in the runner timers and Stellar SDK that turretsService.js
 * initialises at import time.
 */

"use strict";

const knex = require("../db/connection");

/**
 * Return counts of deployments by status. Used by GET /api/turrets/health
 * so operators can see at a glance whether the runner has work to do.
 *
 * @returns {Promise<{ active: number, paused: number, total: number }>}
 */
async function getDeploymentCounts() {
  // Use a single grouped query rather than three count()s so the database
  // only walks the table once.
  const rows = await knex("turrets_deployments")
    .select("status")
    .count({ count: "*" })
    .groupBy("status");

  const counts = { active: 0, paused: 0, total: 0 };
  for (const row of rows) {
    const n = Number(row.count) || 0;
    counts.total += n;
    if (row.status === "active") counts.active = n;
    else if (row.status === "paused") counts.paused = n;
  }
  return counts;
}

module.exports = {
  getDeploymentCounts,
};

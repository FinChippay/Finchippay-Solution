/**
 * src/services/auditService.js
 *
 * Structured, actor-bearing audit records for authz-relevant mutations
 * (webhook CRUD, scheduled-transaction CRUD/execute, notification-preference
 * changes, admin ops). A single writer centralises the schema contract and
 * deliberately never stores raw payload PII (emails, XDRs) — only the ids and
 * a correlation id — so the audit trail satisfies accountability without
 * becoming part of the PII surface (WS5).
 */

"use strict";

const knex = require("../db/connection");
const logger = require("../utils/logger");

/**
 * Write an audit record. Never throws: a failed audit is logged but must not
 * break the underlying mutation (the operator still sees the operation).
 *
 * @param {object} params
 * @param {string|null} [params.actor]              authenticated publicKey, or null
 * @param {string} params.action                    e.g. "webhook.register"
 * @param {string|null} [params.targetPublicKey]    account the mutation concerned
 * @param {string} [params.outcome="success"]       "success" | "failure"
 * @param {string|null} [params.resourceType]       "webhook" | "scheduledTransaction" | "notification_preference"
 * @param {string|number|null} [params.resourceId]
 * @param {string|null} [params.correlationId]      request correlation id
 * @returns {Promise<boolean>}
 */
async function record({
  actor = null,
  action,
  targetPublicKey = null,
  outcome = "success",
  resourceType = null,
  resourceId = null,
  correlationId = null,
} = {}) {
  try {
    await knex("audit_log").insert({
      actor,
      action,
      target_public_key: targetPublicKey,
      outcome,
      resource_type: resourceType || null,
      resource_id: resourceId != null ? String(resourceId) : null,
      correlation_id: correlationId || null,
    });
    return true;
  } catch (err) {
    logger.error({ err, action }, "Failed to write audit log entry");
    return false;
  }
}

/**
 * Query audit records for investigations. Intended to be gated behind an
 * admin-only route; kept intentionally minimal for now.
 *
 * @param {object} [filter]
 * @param {string} [filter.actor]
 * @param {string} [filter.action]
 * @param {string|number} [filter.resourceId]
 * @param {number} [filter.limit=100]
 * @param {number} [filter.offset=0]
 * @returns {Promise<Array>}
 */
async function query({ actor, action, resourceId, limit = 100, offset = 0 } = {}) {
  const q = knex("audit_log").orderBy("created_at", "desc").limit(limit).offset(offset);
  if (actor) q.where("actor", actor);
  if (action) q.where("action", action);
  if (resourceId != null) q.where("resource_id", String(resourceId));
  return q;
}

module.exports = { record, query };

/**
 * Migration 030: extend audit_log with actor + structured metadata.
 *
 * The audit trail must be actor-bearing (who performed an authz-relevant
 * mutation) and immutable (excluded from the PII retention purge, see
 * dataRetentionService). Existing rows written by the retention service held
 * the account id in target_public_key with no actor; we backfill actor from it
 * so the pre-existing history stays attributable (WS5).
 */
exports.up = async function (knex) {
  await knex.schema.alterTable("audit_log", (table) => {
    table.string("actor");
    table.string("outcome").defaultTo("success");
    table.string("resource_type");
    table.string("resource_id");
    table.string("correlation_id");
  });

  // Backfill actor for rows recorded before actor existed.
  await knex("audit_log")
    .update({ actor: knex.ref("target_public_key") })
    .whereNull("actor");
};

exports.down = async function (knex) {
  await knex.schema.alterTable("audit_log", (table) => {
    table.dropColumns("actor", "outcome", "resource_type", "resource_id", "correlation_id");
  });
};

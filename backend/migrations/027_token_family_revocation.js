/**
 * backend/migrations/027_token_family_revocation.js
 * Migration adding token-family and revocation metadata columns to refresh_tokens:
 *
 *   family_id   — UUID grouping a chain of rotated refresh tokens. All tokens
 *                 produced by rotating a single login share one family_id, so a
 *                 theft signal (reuse of an already-rotated token) can revoke
 *                 the whole family at once.
 *   revoked_at  — when the token was revoked (rotation, reuse detection, logout,
 *                 explicit revoke, etc.).
 *   revoked_by  — which mechanism revoked the token ("rotation", "reuse",
 *                 "session", "revoke", "logout", "revoke-all").
 *
 * Columns are added idempotently so the migration is safe on databases that
 * already carry some of them.
 */
"use strict";

exports.up = async function (knex) {
  const hasTable = await knex.schema.hasTable("refresh_tokens");
  if (!hasTable) return;

  const hasFamily = await knex.schema.hasColumn("refresh_tokens", "family_id");
  const hasRevokedAt = await knex.schema.hasColumn("refresh_tokens", "revoked_at");
  const hasRevokedBy = await knex.schema.hasColumn("refresh_tokens", "revoked_by");

  if (!hasFamily || !hasRevokedAt || !hasRevokedBy) {
    await knex.schema.alterTable("refresh_tokens", (table) => {
      if (!hasFamily) table.string("family_id", 36);
      if (!hasRevokedAt) table.timestamp("revoked_at");
      if (!hasRevokedBy) table.string("revoked_by", 32);
    });
  }

  // Best-effort index on family_id (works on both SQLite and PostgreSQL).
  try {
    await knex.raw(
      "CREATE INDEX IF NOT EXISTS idx_refresh_tokens_family_id ON refresh_tokens (family_id)",
    );
  } catch (e) {
    // Index creation is an optimization, not a correctness requirement.
  }
};

exports.down = async function (knex) {
  const hasTable = await knex.schema.hasTable("refresh_tokens");
  if (!hasTable) return;

  await knex.raw("DROP INDEX IF EXISTS idx_refresh_tokens_family_id").catch(() => {});
  await knex.schema
    .alterTable("refresh_tokens", (table) => {
      table.dropColumn("family_id");
      table.dropColumn("revoked_at");
      table.dropColumn("revoked_by");
    })
    .catch(() => {});
};

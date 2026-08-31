/**
 * Migration 032: Add `secret` column to webhooks.
 *
 * WebhookService persists the webhook signing secret as AES-256-GCM ciphertext
 * in `webhooks.secret` (see src/utils/encryption.js) since the encryption
 * rollout, but no migration ever added the column — the original 003 schema
 * only carried `secret_hash`. Against a fully-migrated database every
 * registerWebhook() insert failed with "no column named secret". This closes
 * that schema gap (WS7): the column holds ciphertext only; the plaintext
 * secret is never persisted.
 */

exports.up = async function (knex) {
  const hasSecret = await knex.schema.hasColumn("webhooks", "secret");
  if (!hasSecret) {
    await knex.schema.alterTable("webhooks", (table) => {
      table.text("secret").nullable().comment("AES-256-GCM ciphertext — never plaintext");
    });
  }
};

exports.down = async function (knex) {
  const hasSecret = await knex.schema.hasColumn("webhooks", "secret");
  if (hasSecret) {
    await knex.schema.alterTable("webhooks", (table) => {
      table.dropColumn("secret");
    });
  }
};

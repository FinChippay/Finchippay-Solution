/**
 * Migration 027: Create inbound_webhook_secrets table.
 *
 * Per-endpoint shared secrets used by verifyInboundWebhookSignature.js to
 * authenticate inbound webhook callbacks (e.g. POST /api/sep24/callback)
 * via HMAC-SHA256.
 *
 * Mirrors the encrypted-at-rest pattern already used for outbound webhook
 * secrets (see webhookService.js): the secret is stored as AES-256-GCM
 * ciphertext (secret_encrypted) so it can be decrypted to compute the
 * expected HMAC at verification time, plus a keyed HMAC-SHA256 fingerprint
 * (secret_hash) for defense-in-depth / auditing without decryption. Raw
 * secrets are never written to disk.
 *
 * Multiple rows can be `active` for the same endpoint at once — this is
 * what makes rotation with a grace period possible: rotateSecret() inserts
 * the new secret and, when a grace period is requested, leaves the old row
 * active with `expires_at` set instead of deactivating it immediately.
 */

exports.up = function (knex) {
  return knex.schema.createTable("inbound_webhook_secrets", (table) => {
    table.string("id").primary();
    table.string("endpoint").notNullable().comment("e.g. 'sep24_callback'");
    table.text("secret_encrypted").notNullable().comment("AES-256-GCM ciphertext — never plaintext");
    table.string("secret_hash").notNullable().comment("keyed HMAC-SHA256 fingerprint");
    table.boolean("active").notNullable().defaultTo(true);
    table.timestamp("created_at").defaultTo(knex.fn.now());
    table.timestamp("rotated_at").nullable().comment("set when superseded by a newer secret");
    table.timestamp("expires_at").nullable().comment("grace-period cutoff during rotation; null = no expiry while active");
    table.index("endpoint");
    table.index(["endpoint", "active"]);
  });
};

exports.down = function (knex) {
  return knex.schema.dropTableIfExists("inbound_webhook_secrets");
};

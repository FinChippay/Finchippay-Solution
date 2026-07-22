-- Migration 001: create webhooks table
-- Stores persisted webhook registrations.
--
-- secret_hash: HMAC-SHA256(secret, id) stored as a hex string.
-- Secrets are never stored in plaintext.

CREATE TABLE IF NOT EXISTS webhooks (
  id          TEXT    PRIMARY KEY,
  public_key  TEXT    NOT NULL,
  url         TEXT    NOT NULL,
  secret_hash TEXT    NOT NULL,
  created_at  TEXT    NOT NULL,
  active      INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_webhooks_public_key ON webhooks (public_key);
CREATE INDEX IF NOT EXISTS idx_webhooks_active     ON webhooks (active);

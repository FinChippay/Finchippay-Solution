/**
 * backend/db/webhookDb.js
 *
 * Thin persistence layer for webhook registrations.
 * Uses Node's built-in `node:sqlite` (available from Node 22.5+) — no native
 * compilation, no extra dependencies.
 *
 * Database file: WEBHOOK_DB_PATH env var  (default: data/webhooks.db)
 * In-memory database for tests: set WEBHOOK_DB_PATH=":memory:"
 *
 * The module is a singleton — require() always returns the same open Database
 * instance so connection overhead is paid only once.
 */

"use strict";

const { DatabaseSync } = require("node:sqlite");
const path = require("path");
const fs = require("fs");

const DB_PATH = process.env.WEBHOOK_DB_PATH
  ? process.env.WEBHOOK_DB_PATH
  : path.resolve(__dirname, "..", "data", "webhooks.db");

// Ensure the data directory exists (no-op for :memory:)
if (DB_PATH !== ":memory:") {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

const db = new DatabaseSync(DB_PATH);

// ─── Schema bootstrap ─────────────────────────────────────────────────────────
// Run the DDL inline so the service needs no external migration tooling.
// The SQL mirrors migrations/001_create_webhooks.sql.
db.exec(`
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
`);

// ─── Prepared statements ──────────────────────────────────────────────────────

const stmtInsert = db.prepare(`
  INSERT INTO webhooks (id, public_key, url, secret_hash, created_at, active)
  VALUES (:id, :public_key, :url, :secret_hash, :created_at, 1)
`);

const stmtSelectByPublicKey = db.prepare(`
  SELECT id, public_key, url, created_at
  FROM   webhooks
  WHERE  public_key = :public_key
  AND    active = 1
`);

const stmtSelectAll = db.prepare(`
  SELECT id, public_key, url, secret_hash, created_at
  FROM   webhooks
  WHERE  active = 1
`);

const stmtSelectById = db.prepare(`
  SELECT id, public_key, url, secret_hash, created_at
  FROM   webhooks
  WHERE  id = :id
  AND    active = 1
`);

const stmtDeactivate = db.prepare(`
  UPDATE webhooks
  SET    active = 0
  WHERE  id = :id
  AND    active = 1
`);

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Persist a new webhook row.
 *
 * @param {object} p
 * @param {string} p.id
 * @param {string} p.publicKey
 * @param {string} p.url
 * @param {string} p.secretHash  - HMAC-SHA256 hex digest; never the raw secret
 * @param {string} p.createdAt   - ISO-8601 timestamp
 */
function insertWebhook({ id, publicKey, url, secretHash, createdAt }) {
  stmtInsert.run({
    id,
    public_key: publicKey,
    url,
    secret_hash: secretHash,
    created_at: createdAt,
  });
}

/**
 * Return all active webhooks for `publicKey` (id, publicKey, url, createdAt).
 * Secrets are not returned — callers that need the hash must use `getById`.
 *
 * @param {string} publicKey
 * @returns {Array<{id:string, publicKey:string, url:string, createdAt:string}>}
 */
function getByPublicKey(publicKey) {
  const rows = stmtSelectByPublicKey.all({ public_key: publicKey });
  return rows.map((r) => ({
    id: r.id,
    publicKey: r.public_key,
    url: r.url,
    createdAt: r.created_at,
  }));
}

/**
 * Return ALL active webhooks (used on startup to re-establish SSE streams).
 *
 * @returns {Array<{id:string, publicKey:string, url:string, secretHash:string, createdAt:string}>}
 */
function getAllActive() {
  const rows = stmtSelectAll.all();
  return rows.map((r) => ({
    id: r.id,
    publicKey: r.public_key,
    url: r.url,
    secretHash: r.secret_hash,
    createdAt: r.created_at,
  }));
}

/**
 * Return a single active webhook by `id`, including its secretHash.
 *
 * @param {string} id
 * @returns {{id:string, publicKey:string, url:string, secretHash:string, createdAt:string}|null}
 */
function getById(id) {
  const r = stmtSelectById.get({ id });
  if (!r) return null;
  return {
    id: r.id,
    publicKey: r.public_key,
    url: r.url,
    secretHash: r.secret_hash,
    createdAt: r.created_at,
  };
}

/**
 * Soft-delete (deactivate) a webhook by `id`.
 *
 * @param {string} id
 * @returns {boolean} true if a row was deactivated
 */
function deactivate(id) {
  const result = stmtDeactivate.run({ id });
  return result.changes > 0;
}

/**
 * Close the database connection (useful in tests).
 */
function close() {
  db.close();
}

module.exports = { insertWebhook, getByPublicKey, getAllActive, getById, deactivate, close };

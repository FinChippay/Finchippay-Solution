"use strict";

const crypto = require("crypto");
let knex;
try {
  knex = require("../db/connection");
} catch {
  knex = null;
}

const KEY_BYTES = 40;
const VALID_SCOPES = new Set(["read", "payments:send", "admin"]);
const memoryStore = new Map();
let nextMemoryId = 1;

function hashKey(key) {
  return crypto.createHash("sha256").update(key, "utf8").digest("hex");
}

function normalizeScopes(scopes) {
  if (!Array.isArray(scopes) || scopes.length === 0) {
    throw new Error("At least one API key scope is required.");
  }
  const normalized = [...new Set(scopes.map(String))];
  if (normalized.some((scope) => !VALID_SCOPES.has(scope))) {
    throw new Error("Unsupported API key scope.");
  }
  return normalized;
}

async function isDbAvailable() {
  if (!knex || process.env.JEST_DB_UNAVAILABLE === "true") return false;
  try {
    return await knex.schema.hasTable("api_keys");
  } catch {
    return false;
  }
}

function serializeRecord(row) {
  return {
    id: row.id,
    publicKey: row.public_key || row.publicKey,
    scopes: (() => {
      const parsed = typeof row.scopes === "string" ? JSON.parse(row.scopes) : row.scopes;
      return Array.isArray(parsed) ? parsed : parsed.scopes;
    })(),
    publicKeys: (() => {
      const parsed = typeof row.scopes === "string" ? JSON.parse(row.scopes) : row.scopes;
      return Array.isArray(parsed) ? [row.public_key || row.publicKey] : parsed.publicKeys;
    })(),
    prefix: row.key_prefix || row.keyPrefix,
    revoked: Boolean(row.revoked),
    createdAt: row.created_at || row.createdAt,
    revokedAt: row.revoked_at || row.revokedAt || null,
    lastUsedAt: row.last_used_at || row.lastUsedAt || null,
  };
}

async function createKey(publicKey, scopes, allowedPublicKeys = [publicKey]) {
  const normalizedScopes = normalizeScopes(scopes);
  const normalizedAllowedKeys = [...new Set(allowedPublicKeys.map(String))];
  if (
    normalizedAllowedKeys.length === 0 ||
    normalizedAllowedKeys.some((key) => key !== publicKey)
  ) {
    throw new Error("API key public key scope is invalid.");
  }
  const rawKey = crypto.randomBytes(KEY_BYTES).toString("hex");
  const record = {
    public_key: publicKey,
    key_hash: hashKey(rawKey),
    key_prefix: rawKey.slice(0, 8),
    scopes: JSON.stringify({ scopes: normalizedScopes, publicKeys: normalizedAllowedKeys }),
    revoked: false,
    created_at: new Date(),
    revoked_at: null,
    last_used_at: null,
  };

  if (await isDbAvailable()) {
    const [row] = await knex("api_keys").insert(record).returning("*");
    return { key: rawKey, ...serializeRecord(row) };
  }

  const id = nextMemoryId++;
  memoryStore.set(record.key_hash, { ...record, id });
  return { key: rawKey, ...serializeRecord({ ...record, id }) };
}

async function findByKey(rawKey) {
  if (!rawKey || typeof rawKey !== "string") return null;
  const keyHash = hashKey(rawKey);
  let row;
  if (await isDbAvailable()) {
    row = await knex("api_keys").where({ key_hash: keyHash, revoked: false }).first();
    if (!row) return null;
    await knex("api_keys").where("id", row.id).update({ last_used_at: new Date() });
  } else {
    row = memoryStore.get(keyHash);
    if (!row || row.revoked) return null;
    row.last_used_at = new Date();
  }

  return {
    ...serializeRecord(row),
    keyHash,
    hasScope(scope) {
      return this.scopes.includes(scope);
    },
    allowsPublicKey(publicKey) {
      return this.publicKeys.includes(publicKey);
    },
  };
}

async function listKeys(publicKey) {
  if (await isDbAvailable()) {
    const rows = await knex("api_keys")
      .where("public_key", publicKey)
      .orderBy("created_at", "desc");
    return rows.map(serializeRecord);
  }
  return [...memoryStore.values()]
    .filter((row) => row.public_key === publicKey)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .map(serializeRecord);
}

async function revokeKey(publicKey, id) {
  if (await isDbAvailable()) {
    const count = await knex("api_keys")
      .where({ id: Number(id), public_key: publicKey, revoked: false })
      .update({ revoked: true, revoked_at: new Date() });
    return count > 0;
  }
  for (const row of memoryStore.values()) {
    if (row.id === Number(id) && row.public_key === publicKey && !row.revoked) {
      row.revoked = true;
      row.revoked_at = new Date();
      return true;
    }
  }
  return false;
}

async function clearAll() {
  memoryStore.clear();
  nextMemoryId = 1;
  if (await isDbAvailable()) await knex("api_keys").del();
}

module.exports = {
  KEY_BYTES,
  VALID_SCOPES,
  hashKey,
  createKey,
  findByKey,
  listKeys,
  revokeKey,
  clearAll,
};

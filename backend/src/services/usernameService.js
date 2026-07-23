/**
 * src/services/usernameService.js
 * Business logic for username ↔ Stellar public-key mapping (SEP-0002 federation layer).
 *
 * Uses Knex-backed SQLite/PostgreSQL for persistent storage.
 *
 * Constraints:
 *   - Usernames: 3–20 alphanumeric characters, case-sensitive.
 *   - Each username maps to exactly one public key.
 *   - Each public key may only be registered to one username at a time.
 */

"use strict";

const knex = require("../db/connection");

// ─── Validation helpers ───────────────────────────────────────────────────────

/**
 * Throw a 400 error if `username` is not a valid Finchippay username.
 *
 * Valid format: 3–20 alphanumeric characters (a-z, A-Z, 0-9).
 *
 * @param {string} username
 * @throws {{ message: string, status: 400 }}
 */
function validateUsername(username) {
  if (!username) {
    const err = new Error("Username is required");
    err.status = 400;
    throw err;
  }
  if (!/^[a-zA-Z0-9]{3,20}$/.test(username)) {
    const err = new Error(
      "Username must be 3–20 characters and contain only letters and numbers",
    );
    err.status = 400;
    throw err;
  }
}

/**
 * Throw a 400 error if `publicKey` is not a valid Stellar public key.
 *
 * Valid format: 'G' followed by 55 uppercase alphanumeric characters.
 *
 * @param {string} publicKey
 * @throws {{ message: string, status: 400 }}
 */
function validatePublicKey(publicKey) {
  if (!publicKey) {
    const err = new Error("Public key is required");
    err.status = 400;
    throw err;
  }
  if (!/^G[A-Z0-9]{55}$/.test(publicKey)) {
    const err = new Error("Invalid Stellar public key format");
    err.status = 400;
    throw err;
  }
}

// ─── Core operations ──────────────────────────────────────────────────────────

/**
 * Register a new username for a Stellar public key.
 *
 * @param {string} username - Must satisfy `validateUsername`.
 * @param {string} publicKey - Must satisfy `validatePublicKey`.
 * @returns {Promise<{ username: string, publicKey: string }>}
 * @throws {{ message: string, status: 409 }} if username or public key already registered.
 */
async function registerUsername(username, publicKey) {
  validateUsername(username);
  validatePublicKey(publicKey);

  // Check for existing username
  const existingUsername = await knex("usernames")
    .where("username", username)
    .first();
  if (existingUsername) {
    const err = new Error("Username already registered");
    err.status = 409;
    throw err;
  }

  // Check for existing public key
  const existingKey = await knex("usernames")
    .where("public_key", publicKey)
    .first();
  if (existingKey) {
    const err = new Error("Public key already registered to another username");
    err.status = 409;
    throw err;
  }

  await knex("usernames").insert({
    username,
    public_key: publicKey,
    registered_at: new Date().toISOString(),
  });

  return { username, publicKey };
}

/**
 * Resolve a username to its associated Stellar public key.
 *
 * @param {string} username
 * @returns {Promise<{ username: string, publicKey: string }>}
 * @throws {{ message: string, status: 404 }} if username is not registered.
 */
async function resolveUsername(username) {
  validateUsername(username);

  const row = await knex("usernames").where("username", username).first();
  if (!row) {
    const err = new Error("Username not found");
    err.status = 404;
    throw err;
  }

  return { username: row.username, publicKey: row.public_key };
}

/**
 * Unregister a username.
 *
 * @param {string} username
 * @returns {Promise<{ username: string }>}
 * @throws {{ message: string, status: 404 }} if username is not registered.
 */
async function removeUsername(username) {
  validateUsername(username);

  const deleted = await knex("usernames").where("username", username).del();
  if (!deleted) {
    const err = new Error("Username not found");
    err.status = 404;
    throw err;
  }

  return { username };
}

/**
 * Return all registered username ↔ public-key pairs.
 * Intended for admin / debugging purposes only.
 *
 * @returns {Promise<Array<{ username: string, publicKey: string }>>}
 */
async function getAllUsernames() {
  const rows = await knex("usernames").select("username", "public_key");
  return rows.map((row) => ({
    username: row.username,
    publicKey: row.public_key,
  }));
}

module.exports = {
  registerUsername,
  resolveUsername,
  removeUsername,
  getAllUsernames,
  validateUsername,
  validatePublicKey,
};

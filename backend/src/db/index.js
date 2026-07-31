"use strict";

/**
 * src/db/index.js
 *
 * Re-exports the Knex database connection for backward compatibility.
 * All database operations should go through Knex (db/connection.js),
 * which supports both SQLite and PostgreSQL.
 */
module.exports = require("./connection");

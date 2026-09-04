/**
 * src/config/dockerSecrets.js
 *
 * Docker secrets support: for each name in SECRET_ENV_VARS, if `${NAME}_FILE`
 * points at a file (the standard /run/secrets/<name> mount produced by the
 * top-level `secrets:` block in docker-compose.prod.yml), read it and
 * populate process.env[NAME] before any other module reads it.
 *
 * An explicit process.env[NAME] always wins over the file — this mirrors the
 * file_env() convention used by the official postgres/mysql Docker images.
 *
 * Must be required before any module that reads these vars at load time
 * (e.g. knexfile.js reads DATABASE_URL as soon as src/db/connection.js is
 * first required), so this is loaded immediately after dotenv in server.js.
 */

"use strict";

const fs = require("fs");

const SECRET_ENV_VARS = [
  "JWT_SECRET",
  "DATABASE_URL",
  "WEBHOOK_ENCRYPTION_KEY",
  "RATE_LIMIT_IP_HASH_SALT",
  "ANTHROPIC_API_KEY",
];

/**
 * Resolve `${NAME}_FILE` → env[NAME] for each name in SECRET_ENV_VARS.
 * Exported (in addition to running as a side effect below) so it can be
 * exercised directly in tests without mutating the real process.env.
 *
 * @param {NodeJS.ProcessEnv} [env=process.env]
 */
function loadDockerSecrets(env = process.env) {
  for (const name of SECRET_ENV_VARS) {
    const filePath = env[`${name}_FILE`];
    if (!filePath || env[name]) continue;

    try {
      env[name] = fs.readFileSync(filePath, "utf8").trim();
    } catch (err) {
      throw new Error(`Failed to read ${name} from ${name}_FILE (${filePath}): ${err.message}`);
    }
  }
}

loadDockerSecrets();

module.exports = { loadDockerSecrets, SECRET_ENV_VARS };

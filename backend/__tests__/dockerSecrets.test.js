/* eslint-env jest */
/**
 * __tests__/dockerSecrets.test.js
 * Unit tests for Docker secrets file resolution.
 */

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const { loadDockerSecrets, SECRET_ENV_VARS } = require("../src/config/dockerSecrets");

function writeSecretFile(name, content) {
  const filePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "docker-secrets-test-")), name);
  fs.writeFileSync(filePath, content);
  return filePath;
}

describe("dockerSecrets.loadDockerSecrets", () => {
  it("reads a secret file into the plain env var when only the _FILE var is set", () => {
    const filePath = writeSecretFile("jwt_secret", "super-secret-value\n");
    const env = { JWT_SECRET_FILE: filePath };

    loadDockerSecrets(env);

    expect(env.JWT_SECRET).toBe("super-secret-value");
  });

  it("trims trailing whitespace/newlines from the file content", () => {
    const filePath = writeSecretFile("jwt_secret", "  value-with-padding  \n\n");
    const env = { JWT_SECRET_FILE: filePath };

    loadDockerSecrets(env);

    expect(env.JWT_SECRET).toBe("value-with-padding");
  });

  it("leaves an already-set plain env var untouched, even if _FILE is also set", () => {
    const filePath = writeSecretFile("jwt_secret", "from-file");
    const env = { JWT_SECRET: "from-env", JWT_SECRET_FILE: filePath };

    loadDockerSecrets(env);

    expect(env.JWT_SECRET).toBe("from-env");
  });

  it("is a no-op for secret names whose _FILE var is not set", () => {
    const env = {};

    expect(() => loadDockerSecrets(env)).not.toThrow();
    for (const name of SECRET_ENV_VARS) {
      expect(env[name]).toBeUndefined();
    }
  });

  it("throws a descriptive error when the referenced file does not exist", () => {
    const env = { DATABASE_URL_FILE: "/nonexistent/path/does-not-exist.txt" };

    expect(() => loadDockerSecrets(env)).toThrow(/Failed to read DATABASE_URL from DATABASE_URL_FILE/);
  });

  it("resolves multiple secrets independently", () => {
    const jwtFile = writeSecretFile("jwt_secret", "jwt-value");
    const dbFile = writeSecretFile("database_url", "postgresql://user:pass@host:5432/db");
    const env = { JWT_SECRET_FILE: jwtFile, DATABASE_URL_FILE: dbFile };

    loadDockerSecrets(env);

    expect(env.JWT_SECRET).toBe("jwt-value");
    expect(env.DATABASE_URL).toBe("postgresql://user:pass@host:5432/db");
  });
});

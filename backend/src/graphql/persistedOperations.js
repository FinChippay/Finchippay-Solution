/**
 * src/graphql/persistedOperations.js
 * Optional persisted-operations (trusted documents) enforcement (#630).
 *
 * When enabled, the server only executes queries whose SHA-256 hash is
 * present in a pre-registered manifest, rejecting any other query text
 * outright — this closes off arbitrary-query DoS/information-disclosure
 * vectors entirely in production, at the cost of requiring clients to
 * publish a manifest of the operations they use. Off by default so ad-hoc
 * queries keep working until a client opts in.
 *
 * See docs/graphql-persisted-operations.md for the client-side workflow.
 *
 * Configurable via:
 *   GRAPHQL_PERSISTED_OPERATIONS_ONLY      — "true" to enforce (default: false)
 *   GRAPHQL_PERSISTED_OPERATIONS_MANIFEST  — path to a JSON manifest of
 *                                            { "<sha256Hash>": "<query text>" }
 *                                            (default: persisted-operations.json)
 */

"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { GraphQLError } = require("graphql");
const logger = require("../utils/logger");

const DEFAULT_MANIFEST_PATH = path.join(__dirname, "persisted-operations.json");

function isPersistedOperationsEnforced() {
  return process.env.GRAPHQL_PERSISTED_OPERATIONS_ONLY === "true";
}

function getManifestPath() {
  return process.env.GRAPHQL_PERSISTED_OPERATIONS_MANIFEST || DEFAULT_MANIFEST_PATH;
}

function hashQuery(query) {
  return crypto.createHash("sha256").update(query.trim()).digest("hex");
}

function loadManifest() {
  const manifestPath = getManifestPath();
  try {
    const raw = fs.readFileSync(manifestPath, "utf8");
    const parsed = JSON.parse(raw);
    return new Set(Object.keys(parsed));
  } catch (err) {
    logger.error({ err, manifestPath }, "Failed to load persisted operations manifest");
    return new Set();
  }
}

/**
 * Apollo Server plugin: when enforcement is on, rejects any operation whose
 * query text doesn't hash to an entry in the manifest.
 */
function persistedOperationsPlugin() {
  return {
    async requestDidStart() {
      if (!isPersistedOperationsEnforced()) {
        return {};
      }

      const manifest = loadManifest();

      return {
        async didResolveOperation(requestContext) {
          const query = requestContext.request.query;
          if (!query || manifest.has(hashQuery(query))) {
            return;
          }

          throw new GraphQLError("Operation is not a registered persisted operation", {
            extensions: { code: "PERSISTED_OPERATION_NOT_FOUND" },
          });
        },
      };
    },
  };
}

module.exports = {
  persistedOperationsPlugin,
  isPersistedOperationsEnforced,
  hashQuery,
  loadManifest,
  getManifestPath,
  DEFAULT_MANIFEST_PATH,
};

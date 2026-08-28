"use strict";
const knexConfig = require("../../knexfile");
const logger = require("../utils/logger");
const tracer = require("../config/tracing").getTracer("db");
const { SpanStatusCode } = require("@opentelemetry/api");

const env = process.env.NODE_ENV || "development";
const baseConfig = knexConfig[env] || knexConfig.development;
const queryTimeoutMs = parseInt(process.env.DB_QUERY_TIMEOUT_MS || "30000", 10);
const isPostgres = baseConfig.client === "pg";
const poolConfig = isPostgres
  ? { min: 2, max: 10, acquireTimeoutMillis: 30000 }
  : { min: 1, max: 1 };
const config = {
  ...baseConfig,
  pool: {
    ...baseConfig.pool,
    ...poolConfig,
  },
  acquireConnectionTimeout: queryTimeoutMs,
};
if (isPostgres && !config.connection) {
  throw new Error(`DATABASE_URL must be set for NODE_ENV=${env} (DB_PROVIDER=postgres)`);
}
const knex = require("knex")(config);

// --- OpenTelemetry spans per query (#802) ---
const activeSpans = new Map();

function extractTable(sql) {
  const match = sql.match(/\b(?:from|into|update|table)\s+["`]?([a-zA-Z0-9_]+)["`]?/i);
  return match ? match[1] : "unknown";
}

function extractOperation(method) {
  return method || "query";
}

knex.on("query", (query) => {
  const span = tracer.startSpan(`db.query.${extractOperation(query.method)}`, {
    attributes: {
      "db.system": isPostgres ? "postgresql" : "sqlite",
      "db.operation": extractOperation(query.method),
      "db.table": extractTable(query.sql || ""),
    },
  });
  activeSpans.set(query.__knexQueryUid, span);
});

knex.on("query-response", (response, query) => {
  const span = activeSpans.get(query.__knexQueryUid);
  if (span) {
    span.setStatus({ code: SpanStatusCode.OK });
    span.end();
    activeSpans.delete(query.__knexQueryUid);
  }
});

knex.on("query-error", (err, query) => {
  const span = activeSpans.get(query.__knexQueryUid);
  if (span) {
    span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
    span.recordException(err);
    span.end();
    activeSpans.delete(query.__knexQueryUid);
  }
});

// N+1 query detection logger in development mode
if (env === "development") {
  const queryCounts = new Map();
  knex.on("query", (query) => {
    const sqlShape = query.sql.replace(/\?.*/g, "?");
    const count = (queryCounts.get(sqlShape) || 0) + 1;
    queryCounts.set(sqlShape, count);
    if (count === 4) {
      logger.warn(
        { sql: query.sql },
        `[N+1] Potential N+1 query detected: ${sqlShape} (called 4+ times)`,
      );
    }
  });
  // Reset query counts periodically
  setInterval(() => queryCounts.clear(), 5000);
}
function getPoolStats() {
  const pool = knex.client?.pool;
  if (!pool) {
    return { connected: true, poolSize: 1, activeConnections: 0, idleConnections: 1 };
  }
  return {
    connected: true,
    poolSize: pool.numUsed?.() + pool.numFree?.() || pool.numTotal?.() || 1,
    activeConnections: pool.numUsed?.() || 0,
    idleConnections: pool.numFree?.() || 0,
  };
}
module.exports = knex;
module.exports.getPoolStats = getPoolStats;

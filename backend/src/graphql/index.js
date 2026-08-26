/**
 * src/graphql/index.js
 * Apollo Server setup and mounting for the Finchippay GraphQL API (#630).
 *
 * Hardening applied here:
 *   - Query depth + complexity limits (src/graphql/limits.js) reject
 *     deep/wide DoS queries during validation, before any resolver runs.
 *   - Introspection is gated by NODE_ENV / GRAPHQL_INTROSPECTION
 *     (src/graphql/introspection.js) — off in production by default.
 *   - Request-timeout guard (src/graphql/requestTimeout.js).
 *   - Max-response-size guard (src/graphql/responseSizeGuard.js).
 *   - Optional persisted-operations enforcement (src/graphql/persistedOperations.js).
 *   - formatError strips stack traces / internal details from resolver
 *     errors before they reach the client (validation errors like
 *     depth/complexity keep their descriptive message).
 */

"use strict";

const express = require("express");
const jwt = require("jsonwebtoken");
const { ApolloServer } = require("@apollo/server");
const {
  ApolloServerPluginLandingPageLocalDefault,
} = require("@apollo/server/plugin/landingPage/default");
const { ApolloServerPluginLandingPageDisabled } = require("@apollo/server/plugin/disabled");
const { expressMiddleware } = require("@as-integrations/express4");

const typeDefs = require("./schema");
const resolvers = require("./resolvers");
const { buildValidationRules } = require("./limits");
const { isIntrospectionEnabled } = require("./introspection");
const { responseSizeGuardPlugin } = require("./responseSizeGuard");
const { persistedOperationsPlugin } = require("./persistedOperations");
const { requestTimeoutMiddleware } = require("./requestTimeout");
const logger = require("../utils/logger");

const GRAPHQL_PATH = "/api/graphql";

// Validation-phase errors (depth/complexity limits, syntax errors, persisted
// operation rejection) are safe to surface verbatim — they describe the
// request, not server internals. Everything else (resolver/execution
// errors) is replaced with a generic message in the client-facing response
// so DB errors, file paths, etc. never leak; the real error is still logged.
const SAFE_ERROR_CODES = new Set([
  "GRAPHQL_VALIDATION_FAILED",
  "GRAPHQL_PARSE_FAILED",
  "BAD_USER_INPUT",
  "PERSISTED_OPERATION_NOT_FOUND",
  "RESPONSE_TOO_LARGE",
  "REQUEST_TIMEOUT",
]);

function formatError(formattedError, error) {
  logger.error({ err: error, code: formattedError.extensions?.code }, "GraphQL error");

  const code = formattedError.extensions?.code;
  const isProduction = process.env.NODE_ENV === "production";

  // Validation-phase errors are always safe to show verbatim. Outside
  // production, resolver error messages are also shown as-is (useful for
  // local debugging); in production, anything not explicitly safe is
  // replaced with a generic message so resolver/service internals never
  // reach the client.
  if (!isProduction || (code && SAFE_ERROR_CODES.has(code))) {
    return { message: formattedError.message, extensions: code ? { code } : undefined };
  }

  return {
    message: "Internal server error",
    extensions: { code: code || "INTERNAL_SERVER_ERROR" },
  };
}

async function buildContext({ req }) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return { user: null };
  }

  const jwtSecret = process.env.JWT_SECRET || null;
  if (!jwtSecret) {
    return { user: null };
  }

  try {
    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, jwtSecret);
    if (decoded.publicKey && /^G[A-Z0-9]{55}$/.test(decoded.publicKey)) {
      return { user: decoded };
    }
  } catch {
    // invalid token — context.user stays null
  }

  return { user: null };
}

function createApolloServer() {
  const introspection = isIntrospectionEnabled();

  return new ApolloServer({
    typeDefs,
    resolvers,
    introspection,
    validationRules: buildValidationRules(),
    includeStacktraceInErrorResponses: false,
    formatError,
    plugins: [
      introspection
        ? ApolloServerPluginLandingPageLocalDefault({ footer: false })
        : ApolloServerPluginLandingPageDisabled(),
      persistedOperationsPlugin(),
      responseSizeGuardPlugin(),
    ],
  });
}

/**
 * Create and mount the Apollo Server on `app` at GRAPHQL_PATH.
 *
 * Apollo Server must be started (async) before its Express middleware can
 * handle requests, but this module needs to stay synchronous so the app can
 * be `require()`'d directly (tests do `const app = require("../src/server")`
 * and expect a ready-to-use Express app). The route is mounted immediately;
 * a thin gate middleware defers each request until `apolloServer.start()`
 * has resolved.
 */
function mountGraphQL(app) {
  const apolloServer = createApolloServer();

  // expressMiddleware() asserts the server has already started, so it can't
  // be constructed until `ready` resolves — build it lazily and delegate to
  // it once available, rather than blocking module load on the async start.
  let handler;
  const ready = apolloServer.start().then(() => {
    handler = expressMiddleware(apolloServer, { context: buildContext });
  });

  app.use(GRAPHQL_PATH, requestTimeoutMiddleware(), express.json(), (req, res, next) => {
    ready.then(() => handler(req, res, next)).catch(next);
  });

  return { apolloServer, ready };
}

module.exports = { mountGraphQL, createApolloServer, buildContext, formatError, GRAPHQL_PATH };

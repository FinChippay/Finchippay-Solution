/**
 * src/graphql/limits.js
 * Query depth and complexity validation rules for the GraphQL API (#630).
 *
 * Without limits, a client can submit a deeply nested or highly aliased
 * query that forces exponential resolver work — a classic GraphQL DoS
 * vector. These rules run during query validation, before any resolver
 * executes, so an oversized query is rejected up front.
 *
 * Configurable via env vars (safe defaults applied when unset/invalid):
 *   GRAPHQL_MAX_DEPTH       — max query nesting depth (default: 8)
 *   GRAPHQL_MAX_COMPLEXITY  — max computed query complexity (default: 1000)
 */

"use strict";

const depthLimit = require("graphql-depth-limit");
const {
  createComplexityRule,
  simpleEstimator,
  fieldExtensionsEstimator,
} = require("graphql-query-complexity");

const DEFAULT_MAX_DEPTH = 8;
const DEFAULT_MAX_COMPLEXITY = 1000;

function positiveIntFromEnv(value, fallback) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getMaxDepth() {
  return positiveIntFromEnv(process.env.GRAPHQL_MAX_DEPTH, DEFAULT_MAX_DEPTH);
}

function getMaxComplexity() {
  return positiveIntFromEnv(process.env.GRAPHQL_MAX_COMPLEXITY, DEFAULT_MAX_COMPLEXITY);
}

/**
 * Build the array of graphql-js ValidationRules enforcing depth + complexity
 * limits. Read fresh on every call so tests can flip env vars between runs.
 */
function buildValidationRules() {
  return [
    depthLimit(getMaxDepth()),
    createComplexityRule({
      maximumComplexity: getMaxComplexity(),
      estimators: [fieldExtensionsEstimator(), simpleEstimator({ defaultComplexity: 1 })],
    }),
  ];
}

module.exports = {
  DEFAULT_MAX_DEPTH,
  DEFAULT_MAX_COMPLEXITY,
  getMaxDepth,
  getMaxComplexity,
  buildValidationRules,
};

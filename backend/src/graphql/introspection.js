/**
 * src/graphql/introspection.js
 * Introspection gating for the GraphQL API (#630).
 *
 * Introspection is a fingerprinting/attack-planning aid — it lets a client
 * enumerate the full schema (types, fields, mutations) without any prior
 * knowledge. Disabled by default in production, enabled by default in
 * every other environment, and always overridable via GRAPHQL_INTROSPECTION.
 */

"use strict";

function isIntrospectionEnabled() {
  const flag = process.env.GRAPHQL_INTROSPECTION;
  if (flag !== undefined && flag !== "") {
    return flag === "true" || flag === "1";
  }
  return process.env.NODE_ENV !== "production";
}

module.exports = { isIntrospectionEnabled };

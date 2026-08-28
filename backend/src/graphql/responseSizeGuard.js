/**
 * src/graphql/responseSizeGuard.js
 * Apollo Server plugin that caps outgoing GraphQL response size (#630).
 *
 * Express's body-size limits only guard *incoming* request bodies — nothing
 * stops a query that legitimately passes depth/complexity checks from
 * resolving to a huge payload (e.g. an unbounded list). This plugin measures
 * the serialized response in the willSendResponse hook and, if it exceeds
 * the configured cap, swaps it for a small error payload before it's sent.
 *
 * Configurable via GRAPHQL_MAX_RESPONSE_SIZE_BYTES (default: 2 MiB).
 */

"use strict";

const logger = require("../utils/logger");

const DEFAULT_MAX_RESPONSE_SIZE_BYTES = 2 * 1024 * 1024;

function getMaxResponseSizeBytes() {
  const parsed = parseInt(process.env.GRAPHQL_MAX_RESPONSE_SIZE_BYTES, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_RESPONSE_SIZE_BYTES;
}

function responseSizeGuardPlugin() {
  return {
    async requestDidStart() {
      return {
        async willSendResponse(requestContext) {
          const { response } = requestContext;
          if (response.body?.kind !== "single") {
            return;
          }

          const maxBytes = getMaxResponseSizeBytes();
          const payload = response.body.singleResult;
          const size = Buffer.byteLength(JSON.stringify(payload), "utf8");

          if (size > maxBytes) {
            logger.warn({ size, maxBytes }, "GraphQL response exceeded max size — truncated");
            response.body.singleResult = {
              data: null,
              errors: [
                {
                  message: "Response exceeds maximum allowed size",
                  extensions: { code: "RESPONSE_TOO_LARGE" },
                },
              ],
            };
          }
        },
      };
    },
  };
}

module.exports = {
  responseSizeGuardPlugin,
  getMaxResponseSizeBytes,
  DEFAULT_MAX_RESPONSE_SIZE_BYTES,
};

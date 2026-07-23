/**
 * src/controllers/federationController.js
 * Handles federation requests per SEP-0002.
 */

"use strict";

const axios = require("axios");
const usernameService = require("../services/usernameService");
const { formatErrorResponse, ERROR_CODES } = require("../../../shared/errorCodes");

/**
 * GET /federation?q=<query>&type=<type>
 * Federation endpoint per SEP-0002.
 */
async function resolveFederation(req, res, next) {
  try {
    const { q, type } = req.query;

    if (!q || !type) {
      return res
        .status(ERROR_CODES.VAL_MISSING_FIELD.httpStatus)
        .json(formatErrorResponse("VAL_MISSING_FIELD", { fields: ["q", "type"] }));
    }

    if (typeof q !== "string" || typeof type !== "string") {
      return res
        .status(ERROR_CODES.VAL_MISSING_FIELD.httpStatus)
        .json(formatErrorResponse("VAL_MISSING_FIELD", {
          reason: "q and type must be strings",
        }));
    }

    if (type === "name") {
      // Resolve stellar address to account ID
      const result = await resolveStellarAddress(q, req);
      return res.json(result);
    } else if (type === "id") {
      // Resolve account ID to stellar address
      const result = await resolveAccountId(q);
      return res.json(result);
    } else {
      return res
        .status(ERROR_CODES.VAL_INVALID_FEDERATION_TYPE.httpStatus)
        .json(formatErrorResponse("VAL_INVALID_FEDERATION_TYPE"));
    }
  } catch (err) {
    if (err.response && err.response.status === 404) {
      return res
        .status(ERROR_CODES.RES_NOT_FOUND.httpStatus)
        .json(formatErrorResponse("RES_NOT_FOUND", { resourceType: "federation" }));
    }
    if (err.status) {
      return res.status(err.status).json(formatErrorResponse(err.errorCode || "SRV_INTERNAL", { reason: err.message }));
    }
    next(err);
  }
}

/**
 * Resolve a stellar address (user*domain.com) to an account ID.
 * @param {string} stellarAddress - The stellar address to resolve
 * @returns {Object} Federation response
 */
async function resolveStellarAddress(stellarAddress, req) {
  // Parse the stellar address
  const parts = stellarAddress.split("*");
  if (parts.length !== 2) {
    const error = new Error("Invalid stellar address format");
    error.status = 400;
    error.errorCode = "VAL_INVALID_STELLAR_ADDRESS";
    throw error;
  }

  const [usernameRaw, domainRaw] = parts;
  const username = usernameRaw.trim().toLowerCase();
  const domain = domainRaw.trim().toLowerCase();

  if (!username || !domain) {
    const error = new Error("Invalid stellar address format");
    error.status = 400;
    error.errorCode = "VAL_INVALID_STELLAR_ADDRESS";
    throw error;
  }

  // Check if it's our domain
  if (isLocalFederationDomain(domain, req)) {
    // Local resolution
    const result = usernameService.resolveUsername(username);
    return {
      stellar_address: `${username}*${domain}`,
      account_id: result.publicKey,
    };
  } else {
    // Forward federation to external server
    return await forwardFederation(`${username}*${domain}`, "name");
  }
}

/**
 * Resolve an account ID to a stellar address.
 * @param {string} accountId - The account ID to resolve
 * @returns {Object} Federation response
 */
async function resolveAccountId(accountId) {
  // First check local usernames
  const allUsernames = usernameService.getAllUsernames();
  const match = allUsernames.find(user => user.publicKey === accountId);

  if (match) {
    const domain = getPrimaryFederationDomain();
    return {
      stellar_address: `${match.username}*${domain}`,
      account_id: accountId,
    };
  }

  // If not found locally, we don't support reverse federation for external addresses
  // per SEP-0002, reverse federation is optional
  const error = new Error("Account ID not found");
  error.status = 404;
  error.errorCode = "RES_NOT_FOUND";
  throw error;
}

/**
 * Forward federation request to external federation server.
 * @param {string} query - The query to forward
 * @param {string} type - The type of query
 * @returns {Object} Federation response
 */
async function forwardFederation(query, type) {
  // Parse domain from stellar address
  const parts = query.split("*");
  if (parts.length !== 2) {
    throw new Error("Invalid stellar address format");
  }

  const domain = parts[1];

  // Fetch stellar.toml from the domain
  const tomlUrl = `https://${domain}/.well-known/stellar.toml`;
  const tomlResponse = await axios.get(tomlUrl, { timeout: 5000 });
  const tomlContent = tomlResponse.data;

  // Parse TOML to find FEDERATION_SERVER
  const federationServer = parseFederationServer(tomlContent);
  if (!federationServer) {
    const error = new Error("No federation server found in stellar.toml");
    error.status = 502;
    error.errorCode = "SRV_FEDERATION_FAILED";
    throw error;
  }

  // Make request to external federation server
  const federationUrl = `${federationServer}?q=${encodeURIComponent(query)}&type=${type}`;
  const response = await axios.get(federationUrl, { timeout: 5000 });

  // Validate the returned account_id format per SEP-0002
  // Stellar public keys start with 'G' followed by 55 base32-compatible chars
  if (
    response.data &&
    response.data.account_id &&
    !/^G[A-Z0-9]{55}$/.test(response.data.account_id)
  ) {
    const error = new Error("Invalid Stellar address returned from federation server");
    error.status = 502;
    error.errorCode = "SRV_FEDERATION_FAILED";
    throw error;
  }

  return response.data;
}

/**
 * Parse FEDERATION_SERVER from stellar.toml content.
 * @param {string} tomlContent - The TOML content
 * @returns {string|null} The federation server URL or null
 */
function parseFederationServer(tomlContent) {
  // Simple TOML parsing for the standard SEP-0001 top-level
  // FEDERATION_SERVER value, with support for the older table shape that this
  // project previously emitted.
  const lines = tomlContent.split("\n");
  let inFederationServer = false;
  let server = null;

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const topLevelMatch = trimmed.match(/^FEDERATION_SERVER\s*=\s*"([^"]+)"/);
    if (topLevelMatch) {
      return topLevelMatch[1];
    }

    if (trimmed === "[FEDERATION_SERVER]") {
      inFederationServer = true;
    } else if (inFederationServer && trimmed.startsWith("SERVER")) {
      const match = trimmed.match(/SERVER\s*=\s*"([^"]+)"/);
      if (match) {
        server = match[1];
        break;
      }
    } else if (inFederationServer && trimmed.startsWith("[")) {
      // End of section
      break;
    }
  }

  return server;
}

function stripProtocol(value) {
  return String(value || "")
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .trim()
    .toLowerCase();
}

function getPrimaryFederationDomain() {
  return stripProtocol(
    process.env.FEDERATION_DOMAIN ||
      process.env.DOMAIN ||
      process.env.HOME_DOMAIN ||
      "stellarfinchippay.io"
  );
}

function getLocalFederationDomains(req) {
  const domains = new Set([
    getPrimaryFederationDomain(),
    "stellarfinchippay.io",
    "stellarfinchippay.com",
  ]);

  if (req) {
    const requestHost = stripProtocol(req.get("host"));
    if (requestHost) {
      domains.add(requestHost);
    }
  }

  for (const raw of (process.env.FEDERATION_DOMAINS || "").split(",")) {
    const domain = stripProtocol(raw);
    if (domain) {
      domains.add(domain);
    }
  }

  return domains;
}

function isLocalFederationDomain(domain, req) {
  return getLocalFederationDomains(req).has(stripProtocol(domain));
}

module.exports = {
  resolveFederation,
  parseFederationServer,
  isLocalFederationDomain,
};

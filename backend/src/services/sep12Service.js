/**
 * src/services/sep12Service.js
 * SEP-0012 (KYC API) proxy service.
 *
 * Proxies SEP-12 PUT /customer and GET /customer requests to a Stellar
 * anchor's KYC endpoint.  Keeps an in-memory record of submitted fields
 * and the anchor's last-known status so the frontend can poll for updates
 * without needing to talk to the anchor directly every time.
 *
 * SEP-12 reference:
 *   https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0012.md
 *
 * Supported field types: string, binary, date, number.
 * Supported statuses: NONE, NEEDS_INFO, PROCESSING, ACCEPTED, REJECTED.
 */

"use strict";

const { getRequestIdHeader } = require("../utils/correlationId");
const logger = require("../utils/logger");

// ─── In-memory customer store ────────────────────────────────────────────────

/**
 * @typedef {Object} CustomerRecord
 * @property {string}   publicKey     - Stellar public key (G…)
 * @property {string}   anchorName    - configured anchor name
 * @property {string}   anchorUrl     - anchor's SEP-12 base URL
 * @property {Object}   fields        - last-submitted KYC field values
 * @property {string}   status        - NONE | NEEDS_INFO | PROCESSING | ACCEPTED | REJECTED
 * @property {string}   [message]     - human-readable status message from the anchor
 * @property {string}   createdAt
 * @property {string}   updatedAt
 */

/** @type {Map<string, CustomerRecord>} keyed by `${publicKey}::${anchorName}` */
const customers = new Map();

function _customerKey(publicKey, anchorName) {
  return `${publicKey}::${anchorName}`;
}

// ─── Anchor configuration ────────────────────────────────────────────────────

/**
 * Built-in anchor configurations.  Operators can add more via env vars
 * or extend this map at runtime.
 *
 * Each anchor entry MUST have a `sep12Url` pointing at the anchor's
 * `/sep12` base (e.g. `https://anchor.example.com/sep12`).
 */
const ANCHORS = {
  anchorusd_testnet: {
    name: "AnchorUSD (Testnet)",
    sep12Url:
      process.env.ANCHOR_SEP12_URL || "https://api-testnet.anchorusd.com/sep12",
  },
};

/**
 * Resolve an anchor configuration by name.
 *
 * @param {string} anchorName
 * @returns {{ name: string, sep12Url: string }}
 */
function resolveAnchor(anchorName) {
  if (!anchorName || typeof anchorName !== "string") {
    const err = new Error("anchorName is required");
    err.status = 400;
    throw err;
  }

  // Allow dynamic anchors passed via ANCHOR_SEP12_URL plus any anchor name
  const configured = ANCHORS[anchorName.toLowerCase()];
  if (configured) return configured;

  // Fallback: if ANCHOR_SEP12_URL is set, use it for any unknown anchor name
  const envUrl = process.env.ANCHOR_SEP12_URL;
  if (envUrl) {
    return { name: anchorName, sep12Url: envUrl };
  }

  const err = new Error(
    `Unknown anchor "${anchorName}". Set ANCHOR_SEP12_URL to configure a custom anchor.`,
  );
  err.status = 400;
  throw err;
}

// ─── SEP-12 field validation ─────────────────────────────────────────────────

/**
 * Standard SEP-12 field definitions.
 * By default all fields are type "string", but anchors may accept
 * "binary", "date", and "number" as well.
 */
const SEP12_FIELD_TYPES = new Set(["string", "binary", "date", "number"]);

/**
 * Validate a single SEP-12 field entry.
 *
 * @param {string} key
 * @param {string|Object} value  - plain string or { value, type }
 */
function _validateField(key, value) {
  if (typeof value === "string" || typeof value === "number") return;

  if (value && typeof value === "object") {
    if (value.type && !SEP12_FIELD_TYPES.has(value.type)) {
      throw Object.assign(
        new Error(
          `Invalid field type "${value.type}" for "${key}". Allowed: ${[
            ...SEP12_FIELD_TYPES,
          ].join(", ")}`,
        ),
        { status: 400 },
      );
    }
    return;
  }

  throw Object.assign(
    new Error(
      `Invalid value for field "${key}". Expected a string, number, or { value, type } object.`,
    ),
    { status: 400 },
  );
}

// ─── Anchor HTTP proxy ───────────────────────────────────────────────────────

/**
 * Proxy a PUT /customer request to the anchor's SEP-12 endpoint.
 *
 * SEP-12 spec: the wallet sends a PUT to `${SEP12_URL}/customer` with
 * a JWT Authorization header and a JSON body containing the KYC fields.
 *
 * @param {string} publicKey    - Stellar public key
 * @param {string} sep12Url     - anchor's SEP-12 base URL
 * @param {Object} fields       - KYC field values
 * @param {string} [jwt]        - SEP-0010 JWT for anchor auth
 * @returns {Promise<Object>}   - anchor's response body
 */
async function _proxyPutCustomer(publicKey, sep12Url, fields, jwt) {
  const url = `${sep12Url.replace(/\/$/, "")}/customer`;

  const headers = {
    "Content-Type": "application/json",
    ...getRequestIdHeader(),
  };
  if (jwt) {
    headers["Authorization"] = `Bearer ${jwt}`;
  }

  // Build SEP-12 compliant request body
  const body = {};
  for (const [key, value] of Object.entries(fields)) {
    // Skip empty/blank values — anchors typically treat them as "not provided"
    if (value === "" || value === null || value === undefined) continue;

    if (typeof value === "object" && value !== null && "value" in value) {
      body[key] = value;
    } else if (typeof value === "number") {
      body[key] = { value: value, type: "number" };
    } else {
      body[key] = { value: String(value), type: "string" };
    }
  }

  const response = await fetch(url, {
    method: "PUT",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });

  const responseBody = await response.text().catch(() => "");
  let parsed;
  try {
    parsed = JSON.parse(responseBody);
  } catch {
    parsed = { raw: responseBody };
  }

  if (!response.ok) {
    throw Object.assign(
      new Error(
        `Anchor SEP-12 PUT failed (${response.status}): ${responseBody}`,
      ),
      { status: response.status, anchorResponse: parsed },
    );
  }

  return parsed;
}

/**
 * Proxy a GET /customer request to the anchor's SEP-12 endpoint.
 *
 * @param {string} publicKey
 * @param {string} sep12Url
 * @param {string} [jwt]
 * @returns {Promise<Object>}
 */
async function _proxyGetCustomer(publicKey, sep12Url, jwt) {
  const url = `${sep12Url.replace(/\/$/, "")}/customer`;

  const headers = { ...getRequestIdHeader() };
  if (jwt) {
    headers["Authorization"] = `Bearer ${jwt}`;
  }

  const response = await fetch(url, {
    method: "GET",
    headers,
    signal: AbortSignal.timeout(10_000),
  });

  const responseBody = await response.text().catch(() => "");
  let parsed;
  try {
    parsed = JSON.parse(responseBody);
  } catch {
    parsed = { raw: responseBody };
  }

  if (!response.ok) {
    throw Object.assign(
      new Error(
        `Anchor SEP-12 GET failed (${response.status}): ${responseBody}`,
      ),
      { status: response.status, anchorResponse: parsed },
    );
  }

  return parsed;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Submit KYC fields to the configured anchor per SEP-12 PUT /customer.
 *
 * @param {string} publicKey   - Stellar public key
 * @param {string} anchorName  - configured anchor name (e.g. "anchorusd_testnet")
 * @param {Object} fields      - KYC fields (first_name, last_name, email, …)
 * @param {string} [jwt]       - SEP-0010 JWT for anchor authentication
 * @returns {Promise<CustomerRecord>}
 */
async function putCustomer(publicKey, anchorName, fields, jwt) {
  const anchor = resolveAnchor(anchorName);

  if (
    !fields ||
    typeof fields !== "object" ||
    Object.keys(fields).length === 0
  ) {
    const err = new Error("fields object is required and must not be empty");
    err.status = 400;
    throw err;
  }

  // Validate all fields
  for (const [key, value] of Object.entries(fields)) {
    _validateField(key, value);
  }

  // Proxy to the anchor
  let anchorResponse;
  try {
    anchorResponse = await _proxyPutCustomer(
      publicKey,
      anchor.sep12Url,
      fields,
      jwt,
    );
    logger.info({ publicKey, anchorName }, "SEP-12 PUT /customer success");
  } catch (err) {
    logger.error(
      { err, publicKey, anchorName },
      "SEP-12 PUT /customer proxy failed",
    );
    throw err;
  }

  // Interpret the anchor's response status
  let status = "PROCESSING";
  if (anchorResponse && anchorResponse.status) {
    status = _mapAnchorStatus(anchorResponse.status);
  }

  const key = _customerKey(publicKey, anchorName);
  const existing = customers.get(key);

  const record = {
    publicKey,
    anchorName,
    anchorUrl: anchor.sep12Url,
    fields: { ...(existing?.fields ?? {}), ...fields },
    status,
    message: anchorResponse?.message || null,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  customers.set(key, record);
  return record;
}

/**
 * Fetch the current KYC status from the anchor per SEP-12 GET /customer.
 *
 * @param {string} publicKey
 * @param {string} anchorName
 * @param {string} [jwt]
 * @returns {Promise<CustomerRecord>}
 */
async function getCustomer(publicKey, anchorName, jwt) {
  const anchor = resolveAnchor(anchorName);
  const key = _customerKey(publicKey, anchorName);

  let anchorResponse;
  try {
    anchorResponse = await _proxyGetCustomer(publicKey, anchor.sep12Url, jwt);
  } catch (err) {
    logger.error(
      { err, publicKey, anchorName },
      "SEP-12 GET /customer proxy failed",
    );
    throw err;
  }

  // Merge anchor response with local record
  const existing = customers.get(key);
  const status = _mapAnchorStatus(
    anchorResponse?.status ?? existing?.status ?? "NONE",
  );

  const record = {
    publicKey,
    anchorName,
    anchorUrl: anchor.sep12Url,
    fields: anchorResponse?.fields ?? existing?.fields ?? {},
    status,
    message: anchorResponse?.message || null,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  customers.set(key, record);
  return record;
}

/**
 * Return the simplified KYC status for a user + anchor pair.
 * Proxies to the anchor to get the latest status.
 *
 * Possible values: NONE, NEEDS_INFO, PROCESSING, ACCEPTED, REJECTED
 *
 * @param {string} publicKey
 * @param {string} anchorName
 * @param {string} [jwt]
 * @returns {Promise<{ status: string, message?: string }>}
 */
async function getCustomerStatus(publicKey, anchorName, jwt) {
  try {
    const record = await getCustomer(publicKey, anchorName, jwt);
    return {
      status: record.status,
      message: record.message || undefined,
    };
  } catch {
    // If the anchor is unreachable, fall back to the cached status
    const key = _customerKey(publicKey, anchorName);
    const record = customers.get(key);
    if (!record) {
      return { status: "NONE" };
    }
    return {
      status: record.status,
      message: record.message || undefined,
    };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_MAP = {
  NEEDS_INFO: "NEEDS_INFO",
  PROCESSING: "PROCESSING",
  ACCEPTED: "ACCEPTED",
  REJECTED: "REJECTED",
  VERIFIED: "ACCEPTED", // some anchors return VERIFIED
  PENDING: "PROCESSING",
  DENIED: "REJECTED",
  NONE: "NONE",
};

function _mapAnchorStatus(anchorStatus) {
  const upper = String(anchorStatus || "")
    .toUpperCase()
    .trim();
  return STATUS_MAP[upper] || "NONE";
}

/**
 * Clear the in-memory store (for tests).
 */
function clearStore() {
  customers.clear();
}

module.exports = {
  putCustomer,
  getCustomer,
  getCustomerStatus,
  resolveAnchor,
  clearStore,
};

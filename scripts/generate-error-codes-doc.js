#!/usr/bin/env node
/**
 * scripts/generate-error-codes-doc.js
 * Regenerates docs/error-codes.md from shared/errorCodes.js (#270 / #325).
 *
 * The catalogue is the source of truth; the document is a rendering of it. Run
 * this after adding, removing, or renaming a code:
 *
 *   node scripts/generate-error-codes-doc.js
 *
 * Pass --check to verify the committed document is current without writing —
 * useful in CI to catch a code added without regenerating the docs.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const {
  ERROR_CODES,
  CATEGORY_LAYERS,
  CONTRACT_ERROR_MAP,
  getErrorLayer,
} = require("../shared/errorCodes");

const OUTPUT_PATH = path.join(__dirname, "..", "docs", "error-codes.md");

const CATEGORY_TITLES = {
  AUTH: "Authentication and authorization",
  TOKEN: "Legacy aliases",
  VAL: "Request validation",
  RES: "Resource lifecycle",
  RATE: "Rate limiting",
  CONTRACT: "Soroban contract",
  PAY: "Payments and transactions",
  SRV: "Server and infrastructure",
  WALLET: "Browser wallet",
  GEN: "Generic",
};

/** Reverse of CONTRACT_ERROR_MAP: code key -> numeric ContractError variant. */
const CONTRACT_VARIANTS = Object.fromEntries(
  Object.entries(CONTRACT_ERROR_MAP).map(([num, code]) => [code, Number(num)]),
);

/** Top 10 most commonly encountered errors, ordered by likelihood. */
const COMMON_ERRORS = [
  "AUTH_MISSING_TOKEN",
  "AUTH_EXPIRED_TOKEN",
  "AUTH_INVALID_TOKEN",
  "VAL_INVALID_PUBLIC_KEY",
  "VAL_INVALID_AMOUNT",
  "VAL_MISSING_FIELD",
  "RES_NOT_FOUND",
  "RATE_LIMITED_GLOBAL",
  "PAY_INSUFFICIENT_BALANCE",
  "GEN_NETWORK_ERROR",
];

/** Category descriptions used in the grouping section. */
const CATEGORY_DESCRIPTIONS = {
  AUTH: "Authentication and authorization failures: missing, expired, or invalid tokens, forbidden access, and SEP-0010 challenge verification.",
  TOKEN: "Legacy error code aliases maintained for backward compatibility with existing consumers.",
  VAL: "Request validation failures: malformed input, missing required fields, invalid formats, and constraint violations.",
  RES: "Resource lifecycle errors: resources not found, already exist (conflict), or are no longer available (gone).",
  RATE: "Rate limiting enforcement: requests throttled globally, per sensitive route, or per user account.",
  CONTRACT: "Soroban smart contract errors: authorization, state, arithmetic, and transfer failures returned by on-chain contract calls.",
  PAY: "Payment and transaction errors: building, signing, submitting, confirming, and balance-check failures through the Stellar network.",
  SRV: "Server and infrastructure errors: internal failures, upstream unavailability, missing configuration, and unimplemented features.",
  WALLET: "Browser wallet (Freighter) interaction errors: not installed, not connected, rejected, locked, or network/account mismatches.",
  GEN: "Generic and catch-all errors: unexpected failures, network connectivity issues, and offline detection.",
};

/** Escape the pipe character so a value never breaks a Markdown table row. */
function cell(value) {
  return String(value).replace(/\|/g, "\\|");
}

function groupByCategory() {
  const groups = new Map();
  for (const [key, entry] of Object.entries(ERROR_CODES)) {
    const prefix = key.split("_")[0];
    if (!groups.has(prefix)) groups.set(prefix, []);
    groups.get(prefix).push([key, entry]);
  }
  for (const list of groups.values()) {
    list.sort((a, b) => a[0].localeCompare(b[0]));
  }
  return groups;
}

function renderCategoryDescription(prefix) {
  const desc = CATEGORY_DESCRIPTIONS[prefix];
  return desc ? "\n" + desc + "\n" : "";
}

function renderCategoryTable(entries) {
  const hasContractVariants = entries.some(([key]) => key in CONTRACT_VARIANTS);

  const header = hasContractVariants
    ? "| Code | HTTP | ContractError | Message |"
    : "| Code | HTTP | Message |";

  const headerSep = hasContractVariants
    ? "| --- | --- | --- | --- |"
    : "| --- | --- | --- |";

  const rows = entries.map(([key, entry]) => {
    const status = entry.httpStatus > 0 ? entry.httpStatus : "n/a";
    const note = entry.deprecated
      ? " **Deprecated** -- use `" + entry.supersededBy + "`."
      : "";
    const message = cell(entry.message) + note;

    return hasContractVariants
      ? "| `" + key + "` | " + status + " | " + (CONTRACT_VARIANTS[key] ?? "---") + " | " + message + " |"
      : "| `" + key + "` | " + status + " | " + message + " |";
  });

  return [header, headerSep, ...rows].join("\n");
}

function renderCommonErrors() {
  const entries = COMMON_ERRORS.map(function(key) {
    return [key, ERROR_CODES[key]];
  }).filter(function(item) {
    return item[1];
  });

  const rows = entries.map(function(item) {
    var key = item[0], entry = item[1];
    var status = entry.httpStatus > 0 ? entry.httpStatus : "n/a";
    var message = cell(entry.message);
    var note = entry.deprecated
      ? " **Deprecated** -- use `" + entry.supersededBy + "`."
      : "";
    return "| `" + key + "` | " + status + " | " + message + note + " |";
  });

  return ["| Code | HTTP | Message |", "| --- | --- | --- |"].concat(rows).join("\n");
}

function renderExampleResponse(key) {
  var entry = ERROR_CODES[key];
  if (!entry) return "";
  var example = {
    error: {
      code: entry.code,
      message: entry.message,
      correlationId: "6f1a2b3c-4d5e-6f70-8192-a3b4c5d6e7f8",
    },
  };
  return "```json\n" + JSON.stringify(example, null, 2) + "\n```";
}

function renderTimestamp() {
  var now = new Date();
  var dateStr = now.toISOString().replace("T", " ").replace(/\..+/, "") + " UTC";
  return dateStr;
}

function slugify(text) {
  return text.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
}

function render() {
  var groups = groupByCategory();
  var total = Object.keys(ERROR_CODES).length;
  var timestamp = renderTimestamp();

  var sortedPrefixes = [...groups.keys()].sort();

  var summaryRows = sortedPrefixes.map(function(prefix) {
    var entries = groups.get(prefix);
    return "| `" + prefix + "_*` | " + (CATEGORY_LAYERS[prefix] || "shared") + " | " + entries.length + " | " + (CATEGORY_TITLES[prefix] || prefix) + " |";
  });

  var tocPrefixes = sortedPrefixes.map(function(prefix) {
    var title = CATEGORY_TITLES[prefix] || prefix;
    var anchor = prefix.toLowerCase() + "-" + slugify(title);
    return "- [`" + prefix + "_*` — " + title + "](#" + anchor + ")";
  });

  var sections = sortedPrefixes.map(function(prefix) {
    var entries = groups.get(prefix);
    var layer = CATEGORY_LAYERS[prefix] || "shared";
    var title = CATEGORY_TITLES[prefix] || prefix;
    var parts = [
      "### `" + prefix + "_*` — " + title,
      "",
      "Layer: **" + layer + "**",
      renderCategoryDescription(prefix),
      renderCategoryTable(entries),
    ];
    return parts.join("\n");
  });

  var doc =
    "<!--\n  GENERATED FILE — do not edit by hand.\n  Source: shared/errorCodes.js\n  Regenerate: node scripts/generate-error-codes-doc.js\n  Generated: " + timestamp + "\n-->\n\n" +
    "# Error codes\n\n" +
    "> **Last generated:** " + timestamp + "\n\n" +
    "Every error Finchippay returns carries a machine-readable code from a single\n" +
    "catalogue shared by the contract, the API, and the frontend. This document is\n" +
    "generated from that catalogue, so it cannot drift from the code.\n\n" +
    "**" + total + " codes** are defined in [`shared/errorCodes.js`](../shared/errorCodes.js).\n\n" +
    "---\n\n" +
    "## Table of contents\n\n" +
    "- [Response format](#response-format)\n" +
    "- [Correlation IDs](#correlation-ids)\n" +
    "- [Naming conventions](#naming)\n" +
    "- [Category overview](#category-overview)\n" +
    "- [Common errors](#common-errors)\n" +
    "- [Using the catalogue](#using-the-catalogue)\n" +
    "  - [Backend](#backend)\n" +
    "  - [Frontend](#frontend)\n" +
    "  - [Contract](#contract)\n" +
    "- [Full catalogue](#catalogue)\n" +
    tocPrefixes.map(function(t) { return "  " + t; }).join("\n") + "\n\n" +
    "---\n\n" +
    "## Response format\n\n" +
    "Every API error uses the same body:\n\n" +
    "```json\n{\n  \"error\": {\n    \"code\": \"VAL_INVALID_PUBLIC_KEY\",\n    \"message\": \"Invalid Stellar public key format.\",\n    \"correlationId\": \"6f1a2b3c-4d5e-6f70-8192-a3b4c5d6e7f8\",\n    \"details\": { \"field\": \"destination\" }\n  }\n}\n```\n\n" +
    "| Field | Always present | Description |\n" +
    "| --- | --- | --- |\n" +
    "| `error.code` | yes | Machine-readable code from this catalogue. Switch on this, never on the message. |\n" +
    "| `error.message` | yes | Human-readable description. Written for developers; the frontend maps codes to user-facing copy separately. |\n" +
    "| `error.correlationId` | on API responses | Matches the `X-Request-ID` response header and the `correlationId` field in the server logs. |\n" +
    "| `error.details` | no | Code-specific context: the offending field, the received value, and so on. |\n\n" +
    "The `error` key is at the top level, so consumers written against the original\n" +
    "`{ error }` contract keep working.\n\n" +
    "### Correlation IDs\n\n" +
    "The API generates a UUID for every request, or adopts an inbound\n" +
    "`X-Request-ID` header if the caller supplies one. That value is:\n\n" +
    "1. returned in the `X-Request-ID` response header,\n" +
    "2. embedded as `error.correlationId` in error bodies,\n" +
    "3. logged with every log line for the request.\n\n" +
    "Quoting one ID therefore locates the failure across all three. See\n" +
    "[`backend/src/utils/correlationId.js`](../backend/src/utils/correlationId.js).\n\n" +
    "## Naming\n\n" +
    "Codes are `CATEGORY_SPECIFIC`. The category prefix determines the owning\n" +
    "layer, so the layer never has to be repeated in the code itself — use\n" +
    "`getErrorLayer(code)` to resolve it programmatically.\n\n" +
    "**Message template placeholders:** Some messages contain placeholders that are\n" +
    "replaced at runtime with context-specific values:\n\n" +
    "| Placeholder | Meaning |\n" +
    "| --- | --- |\n" +
    "| `<token>` | An authentication token value |\n" +
    "| `<destination>` | A Stellar address or account ID |\n" +
    "| `<amount>` | A numeric amount in stroops or lumen |\n" +
    "| `<field>` | A request body field name |\n" +
    "| `<limit>` | A maximum allowed value (rate, size, count) |\n\n" +
    "## Category overview\n\n" +
    "| Prefix | Layer | Codes | Meaning |\n" +
    "| --- | --- | --- | --- |\n" +
    summaryRows.join("\n") + "\n\n" +
    "## Common errors\n\n" +
    "The following **" + COMMON_ERRORS.length + " error codes** are the most commonly\n" +
    "encountered by API consumers. Check this section first when troubleshooting.\n\n" +
    renderCommonErrors() + "\n\n" +
    "### Example response (auth)\n\n" + renderExampleResponse("AUTH_MISSING_TOKEN") + "\n\n" +
    "### Example response (validation)\n\n" + renderExampleResponse("VAL_INVALID_PUBLIC_KEY") + "\n\n" +
    "### Example response (not found)\n\n" + renderExampleResponse("RES_NOT_FOUND") + "\n\n" +
    "### Example response (rate limited)\n\n" + renderExampleResponse("RATE_LIMITED_GLOBAL") + "\n\n" +
    "### Example response (payment failure)\n\n" + renderExampleResponse("PAY_INSUFFICIENT_BALANCE") + "\n\n" +
    "## Using the catalogue\n\n" +
    "### Backend\n\n" +
    "Prefer [`backend/src/utils/errorResponse.js`](../backend/src/utils/errorResponse.js),\n" +
    "which resolves the HTTP status from the catalogue so a status can never drift\n" +
    "from its code:\n\n" +
    "```js\nconst { sendError, createError } = require(\"../utils/errorResponse\");\n\n// Respond immediately.\nreturn sendError(res, \"VAL_INVALID_PUBLIC_KEY\", {\n  details: { field: \"destination\" },\n});\n\n// Or hand off to the global error handler.\nreturn next(createError(\"RES_NOT_FOUND\"));\n```\n\n" +
    "### Frontend\n\n" +
    "[`frontend/lib/handleError.ts`](../frontend/lib/handleError.ts) maps a code to\n" +
    "user-facing copy and a recovery action:\n\n" +
    "```ts\nconst handled = await handleApiError(response);\n// handled.title        -> \"Not enough balance\"\n// handled.userMessage  -> \"Your balance will not cover this payment ...\"\n// handled.action       -> { kind: \"fund\", label: \"Add funds\" }\n// handled.correlationId -> \"6f1a2b3c-...\"\n```\n\n" +
    "Recovery actions are `retry`, `reconnect`, `reauth`, `fix_input`,\n" +
    "`wait`, `fund`, `contact_support`, and `none`.\n\n" +
    "### Contract\n\n" +
    "The Soroban contract's `ContractError` enum returns numeric variants. The\n" +
    "`ContractError` column below gives the variant each `CONTRACT_*` code maps\n" +
    "from; `getContractErrorCode(n)` performs the lookup.\n\n" +
    "## Catalogue\n\n" +
    sections.join("\n\n") + "\n\n" +
    "---\n\n" +
    "*Document auto-generated on " + timestamp + " from [`shared/errorCodes.js`](../shared/errorCodes.js).*\n";

  return doc;
}

function main() {
  var content = render();
  var checkOnly = process.argv.indexOf("--check") !== -1;

  if (checkOnly) {
    var existing = fs.existsSync(OUTPUT_PATH)
      ? fs.readFileSync(OUTPUT_PATH, "utf8")
      : "";
    // Strip timestamps before comparing so CI does not false-fail on regeneration time
    var datePat = /\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} UTC/g;
    var normalizedExisting = existing.replace(datePat, "TIMESTAMP_STRIPPED");
    var normalizedContent = content.replace(datePat, "TIMESTAMP_STRIPPED");
    if (normalizedExisting !== normalizedContent) {
      process.stderr.write(
        "docs/error-codes.md is out of date. Run: node scripts/generate-error-codes-doc.js\n",
      );
      process.exit(1);
    }
    process.stdout.write("docs/error-codes.md is up to date.\n");
    return;
  }

  fs.writeFileSync(OUTPUT_PATH, content, "utf8");
  process.stdout.write(
    "Wrote " + OUTPUT_PATH + " (" + Object.keys(ERROR_CODES).length + " codes).\n",
  );
}

main();

module.exports = { render: render, getErrorLayer: getErrorLayer };

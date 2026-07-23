#!/usr/bin/env node
/**
 * scripts/generate-error-codes-doc.js
 * Regenerates docs/error-codes.md from shared/errorCodes.js (#270).
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

/** Reverse of CONTRACT_ERROR_MAP: code key → numeric ContractError variant. */
const CONTRACT_VARIANTS = Object.fromEntries(
  Object.entries(CONTRACT_ERROR_MAP).map(([num, code]) => [code, Number(num)]),
);

/** Escape the pipe character so a message never breaks a Markdown table row. */
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

function renderCategoryTable(entries) {
  const hasContractVariants = entries.some(([key]) => key in CONTRACT_VARIANTS);

  const header = hasContractVariants
    ? "| Code | HTTP | ContractError | Message |\n| --- | --- | --- | --- |"
    : "| Code | HTTP | Message |\n| --- | --- | --- |";

  const rows = entries.map(([key, entry]) => {
    const status = entry.httpStatus > 0 ? entry.httpStatus : "n/a";
    const note = entry.deprecated
      ? ` **Deprecated** — use \`${entry.supersededBy}\`.`
      : "";
    const message = cell(entry.message) + note;

    return hasContractVariants
      ? `| \`${key}\` | ${status} | ${CONTRACT_VARIANTS[key] ?? "—"} | ${message} |`
      : `| \`${key}\` | ${status} | ${message} |`;
  });

  return [header, ...rows].join("\n");
}

function render() {
  const groups = groupByCategory();
  const total = Object.keys(ERROR_CODES).length;

  const summaryRows = [...groups.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(
      ([prefix, entries]) =>
        `| \`${prefix}_*\` | ${CATEGORY_LAYERS[prefix] || "shared"} | ${entries.length} | ${
          CATEGORY_TITLES[prefix] || prefix
        } |`,
    );

  const sections = [...groups.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([prefix, entries]) => {
      const layer = CATEGORY_LAYERS[prefix] || "shared";
      return [
        `### \`${prefix}_*\` — ${CATEGORY_TITLES[prefix] || prefix}`,
        "",
        `Layer: **${layer}**`,
        "",
        renderCategoryTable(entries),
      ].join("\n");
    });

  return `<!--
  GENERATED FILE — do not edit by hand.
  Source: shared/errorCodes.js
  Regenerate: node scripts/generate-error-codes-doc.js
-->

# Error codes

Every error Finchippay returns carries a machine-readable code from a single
catalogue shared by the contract, the API, and the frontend. This document is
generated from that catalogue, so it cannot drift from the code.

**${total} codes** are defined in [\`shared/errorCodes.js\`](../shared/errorCodes.js).

## Response format

Every API error uses the same body:

\`\`\`json
{
  "error": {
    "code": "VAL_INVALID_PUBLIC_KEY",
    "message": "Invalid Stellar public key format.",
    "correlationId": "6f1a2b3c-4d5e-6f70-8192-a3b4c5d6e7f8",
    "details": { "field": "destination" }
  }
}
\`\`\`

| Field | Always present | Description |
| --- | --- | --- |
| \`error.code\` | yes | Machine-readable code from this catalogue. Switch on this, never on the message. |
| \`error.message\` | yes | Human-readable description. Written for developers; the frontend maps codes to user-facing copy separately. |
| \`error.correlationId\` | on API responses | Matches the \`X-Request-ID\` response header and the \`correlationId\` field in the server logs. |
| \`error.details\` | no | Code-specific context: the offending field, the received value, and so on. |

The \`error\` key is at the top level, so consumers written against the original
\`{ error }\` contract keep working.

### Correlation IDs

The API generates a UUID for every request, or adopts an inbound
\`X-Request-ID\` header if the caller supplies one. That value is:

1. returned in the \`X-Request-ID\` response header,
2. embedded as \`error.correlationId\` in error bodies,
3. logged with every log line for the request.

Quoting one ID therefore locates the failure across all three. See
[\`backend/src/utils/correlationId.js\`](../backend/src/utils/correlationId.js).

## Naming

Codes are \`CATEGORY_SPECIFIC\`. The category prefix determines the owning
layer, so the layer never has to be repeated in the code itself — use
\`getErrorLayer(code)\` to resolve it programmatically.

| Prefix | Layer | Codes | Meaning |
| --- | --- | --- | --- |
${summaryRows.join("\n")}

## Using the catalogue

### Backend

Prefer [\`backend/src/utils/errorResponse.js\`](../backend/src/utils/errorResponse.js),
which resolves the HTTP status from the catalogue so a status can never drift
from its code:

\`\`\`js
const { sendError, createError } = require("../utils/errorResponse");

// Respond immediately.
return sendError(res, "VAL_INVALID_PUBLIC_KEY", {
  details: { field: "destination" },
});

// Or hand off to the global error handler.
return next(createError("RES_NOT_FOUND"));
\`\`\`

### Frontend

[\`frontend/lib/handleError.ts\`](../frontend/lib/handleError.ts) maps a code to
user-facing copy and a recovery action:

\`\`\`ts
const handled = await handleApiError(response);
// handled.title        → "Not enough balance"
// handled.userMessage  → "Your balance will not cover this payment ..."
// handled.action       → { kind: "fund", label: "Add funds" }
// handled.correlationId → "6f1a2b3c-..."
\`\`\`

Recovery actions are \`retry\`, \`reconnect\`, \`reauth\`, \`fix_input\`,
\`wait\`, \`fund\`, \`contact_support\`, and \`none\`.

### Contract

The Soroban contract's \`ContractError\` enum returns numeric variants. The
\`ContractError\` column below gives the variant each \`CONTRACT_*\` code maps
from; \`getContractErrorCode(n)\` performs the lookup.

## Catalogue

${sections.join("\n\n")}
`;
}

function main() {
  const content = render();
  const checkOnly = process.argv.includes("--check");

  if (checkOnly) {
    const existing = fs.existsSync(OUTPUT_PATH)
      ? fs.readFileSync(OUTPUT_PATH, "utf8")
      : "";
    if (existing !== content) {
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
    `Wrote ${OUTPUT_PATH} (${Object.keys(ERROR_CODES).length} codes).\n`,
  );
}

main();

module.exports = { render, getErrorLayer };

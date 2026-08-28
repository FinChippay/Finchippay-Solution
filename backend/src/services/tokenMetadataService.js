/**
 * Simple token metadata service for SIP-010 compatibility.
 *
 * This implementation is intentionally conservative: it reads a small local
 * JSON manifest (backend/data/token-metadata.json) and returns a stable
 * shape. CI / production can replace this with a richer on-chain resolver.
 */
"use strict";

const path = require("path");
const fs = require("fs");

const METADATA_PATH = path.join(__dirname, "..", "..", "data", "token-metadata.json");

function loadManifest() {
  try {
    if (!fs.existsSync(METADATA_PATH)) return {};
    const raw = fs.readFileSync(METADATA_PATH, "utf8");
    return JSON.parse(raw || "{}");
  } catch (e) {
    return {};
  }
}

async function getTokenMetadata(contractId) {
  const manifest = loadManifest();
  const entry = manifest[contractId];
  if (!entry) {
    // Return the SIP-010 shape with nulls for unknown values
    return {
      contractId,
      name: null,
      symbol: null,
      decimals: null,
      description: null,
      icon_url: null,
    };
  }

  return {
    contractId,
    name: entry.name || null,
    symbol: entry.symbol || null,
    decimals: typeof entry.decimals === "number" ? entry.decimals : null,
    description: entry.description || null,
    icon_url: entry.icon_url || null,
  };
}

module.exports = { getTokenMetadata };

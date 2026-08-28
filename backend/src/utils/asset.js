"use strict";

/**
 * Validates and normalizes an asset string.
 * @param {string} assetStr - The asset string (e.g., "XLM" or "USDC:G...")
 * @returns {string} The normalized asset string (e.g. "XLM" or "CODE:ISSUER").
 * @throws {Error} 400 error if non-XLM without an issuer.
 */
function normalizeAsset(assetStr) {
  if (!assetStr || assetStr === "XLM") return "XLM";
  const parts = assetStr.split(":");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    const err = new Error("Non-XLM asset must be formatted as CODE:ISSUER");
    err.status = 400;
    throw err;
  }
  return assetStr;
}

module.exports = {
  normalizeAsset,
};

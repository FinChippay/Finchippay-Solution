"use strict";

function loadAnchors() {
  const raw = process.env.ANCHORS_CONFIG;

  if (!raw) {
    // Sensible default so the feature works out of the box in dev/testnet.
    return {
      testanchor: {
        name: "testanchor",
        sep24Url: "https://testanchor.stellar.org/sep24",
        supportedAssets: ["SRT", "USDC"],
      },
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`ANCHORS_CONFIG must be valid JSON: ${err.message}`);
  }

  const anchors = {};
  for (const [name, cfg] of Object.entries(parsed)) {
    if (!cfg.sep24Url) {
      throw new Error(`Anchor "${name}" is missing required "sep24Url"`);
    }
    anchors[name] = {
      name,
      sep24Url: cfg.sep24Url,
      apiKey: cfg.apiKey || null,
      supportedAssets: cfg.supportedAssets || [],
    };
  }
  return anchors;
}

const ANCHORS = loadAnchors();

function getAnchor(name) {
  const anchor = ANCHORS[name || "testanchor"];
  if (!anchor) {
    const err = new Error(
      `Unknown anchor "${name}". Configured anchors: ${Object.keys(ANCHORS).join(", ") || "none"}`,
    );
    err.status = 400;
    throw err;
  }
  return anchor;
}

module.exports = { ANCHORS, getAnchor };
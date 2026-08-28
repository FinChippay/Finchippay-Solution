"use strict";

function loadAnchors() {
  const raw = process.env.ANCHORS_CONFIG;
  const isDev = process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test";

  if (!raw) {
    if (isDev) {
      const logger = require("../utils/logger");
      logger.warn(
        "ANCHORS_CONFIG not set — using development-only default anchor. " +
          "Set ANCHORS_CONFIG in production to prevent startup failure.",
      );
      return {
        testanchor: {
          name: "testanchor",
          sep24Url: "https://testanchor.stellar.org/sep24",
          supportedAssets: ["SRT", "USDC"],
        },
      };
    }
    throw new Error(
      "ANCHORS_CONFIG environment variable is required in production. " +
        "Set it to a JSON object mapping anchor names to { sep24Url, supportedAssets }.",
    );
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

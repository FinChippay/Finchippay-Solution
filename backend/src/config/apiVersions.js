/**
 * src/config/apiVersions.js
 *
 * Central registry of supported API versions with metadata for
 * deprecation tracking, version negotiation, and documentation.
 */
"use strict";

const VERSIONS = [
  {
    version: "1",
    releaseDate: "2026-01-15",
    deprecationDate: null,
    sunsetDate: null,
    status: "active",
  },
];

function getLatestVersion() {
  const active = VERSIONS.filter((v) => v.status === "active");
  if (active.length === 0) return null;
  return active[active.length - 1];
}

function isVersionSupported(version) {
  return VERSIONS.some((v) => v.version === version);
}

function isVersionDeprecated(version) {
  const v = VERSIONS.find((v) => v.version === version);
  return v ? v.status === "deprecated" || v.status === "sunset" : false;
}

function getDeprecationHeaders(version) {
  const v = VERSIONS.find((v) => v.version === version);
  if (!v) return {};

  const headers = {
    "X-API-Version": version,
  };

  if (v.status === "deprecated" || v.status === "sunset") {
    headers["X-API-Deprecated"] = "true";
    if (v.sunsetDate) {
      headers["Sunset"] = new Date(v.sunsetDate).toUTCString();
    }
  }

  return headers;
}

module.exports = {
  VERSIONS,
  getLatestVersion,
  isVersionSupported,
  isVersionDeprecated,
  getDeprecationHeaders,
};

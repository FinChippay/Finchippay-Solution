/**
 * src/middleware/apiVersion.js
 *
 * Express middleware for API version negotiation supporting:
 * - URL-prefix versioning (/api/v1/payments, /api/v2/payments)
 * - Accept-Version header negotiation
 * - Deprecation warning headers
 * - Version validation
 */
"use strict";

const {
  getLatestVersion,
  isVersionSupported,
  isVersionDeprecated,
  getDeprecationHeaders,
} = require("../config/apiVersions");

const API_PREFIX_REGEX = /^\/api\/v(\d+)\//;
const API_ROOT_REGEX = /^\/api\//;

/**
 * Express middleware that extracts the requested API version from:
 * 1. The URL prefix (/api/v1/...)
 * 2. The Accept-Version header
 *
 * Sets req.apiVersion and optionally rewrites the URL for downstream routes.
 */
function apiVersionMiddleware(req, res, next) {
  let version = null;
  let matched = false;

  // 1. Try URL prefix
  const urlMatch = req.path.match(API_PREFIX_REGEX);
  if (urlMatch) {
    version = urlMatch[1];
    matched = true;
    // Rewrite path so downstream routes don't need to know about versioning
    req.url = req.url.replace(`/v${version}`, "");
    req.originalUrl = req.originalUrl.replace(`/v${version}`, "");
  }

  // 2. Try Accept-Version header (lower priority than URL prefix)
  if (!version) {
    const acceptVersion = req.get("Accept-Version");
    if (acceptVersion) {
      version = acceptVersion.trim();
    }
  }

  // 3. Default to latest version
  if (!version) {
    const latest = getLatestVersion();
    if (latest) {
      version = latest.version;
    }
  }

  // 4. Validate version is supported
  if (!version || !isVersionSupported(version)) {
    return res.status(400).json({
      error: "UNSUPPORTED_API_VERSION",
      message: `API version "${version}" is not supported. Supported versions: v1`,
      supportedVersions: ["v1"],
    });
  }

  req.apiVersion = version;
  req.apiVersionMatched = matched;

  // 5. Set response headers
  if (matched) {
    const headers = getDeprecationHeaders(version);
    for (const [key, value] of Object.entries(headers)) {
      res.setHeader(key, String(value));
    }
  } else {
    // Not versioned in URL — set deprecation headers for unversioned access
    res.setHeader("X-API-Version", version);
    if (isVersionDeprecated(version)) {
      res.setHeader("X-API-Deprecated", "true");
    }
  }

  next();
}

/**
 * Helper middleware that adds deprecation warning headers for unversioned
 * access to /api/... routes (redirects /api/... to /api/v1/...).
 */
function unversionedRedirectMiddleware(req, res, next) {
  if (
    req.apiVersionMatched === false &&
    API_ROOT_REGEX.test(req.path) &&
    !req.path.startsWith("/api/v")
  ) {
    res.setHeader("X-API-Deprecated", "true");
    res.setHeader(
      "X-API-Deprecation-Message",
      "Unversioned API access is deprecated. Use /api/v1/... instead.",
    );
  }
  next();
}

module.exports = {
  apiVersionMiddleware,
  unversionedRedirectMiddleware,
};

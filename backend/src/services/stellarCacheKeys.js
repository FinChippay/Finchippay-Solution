/**
 * Network-scoped cache keys for data read from Stellar Horizon.
 *
 * HORIZON_URL is captured when the application configuration is loaded, which
 * keeps all cache consumers in this process on the same network namespace.
 */
"use strict";

const { HORIZON_URL } = require("../config/stellar");

function networkCacheNamespace(horizonUrl = HORIZON_URL) {
  return encodeURIComponent(horizonUrl);
}

const NETWORK_CACHE_NAMESPACE = networkCacheNamespace();

function accountCacheKey(publicKey) {
  return `account:${NETWORK_CACHE_NAMESPACE}:${publicKey}`;
}

function paymentsCacheKey(publicKey, limit) {
  return `payments:${NETWORK_CACHE_NAMESPACE}:${publicKey}:${limit}`;
}

function paymentsCountCacheKey(publicKey, cap) {
  return `payments:count:${NETWORK_CACHE_NAMESPACE}:${publicKey}:${cap}`;
}

function paymentsCachePattern(publicKey) {
  return `payments:${NETWORK_CACHE_NAMESPACE}:${publicKey}:*`;
}

module.exports = {
  NETWORK_CACHE_NAMESPACE,
  networkCacheNamespace,
  accountCacheKey,
  paymentsCacheKey,
  paymentsCountCacheKey,
  paymentsCachePattern,
};

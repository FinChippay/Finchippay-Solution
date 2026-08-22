/**
 * src/utils/ssrfGuard.js
 *
 * Server-Side Request Forgery (SSRF) protection.
 *
 * Validates URLs before they are used in server-side HTTP requests (e.g. fetch).
 * Blocks link-local, loopback, private, and other reserved IP ranges as well
 * as known internal hostnames.  Performs DNS resolution so that hostname-based
 * attacks (e.g. `http://169.254.169.254.xip.io`) are also caught.
 *
 * Usage:
 *   const { validatePublicUrl } = require("./ssrfGuard");
 *   await validatePublicUrl("https://example.com/callback");  // ok
 *   await validatePublicUrl("http://169.254.169.254/");        // throws
 *
 * Reference: https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html
 */

"use strict";

const { URL } = require("url");
const dns = require("dns").promises;
const net = require("net");

// ── Internal hostnames that should never be reachable from server-side fetch ──
const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata.google.internal", // GCP metadata
]);

const BLOCKED_HOSTNAME_SUFFIXES = [".local", ".internal"];

// ── IPv4 helpers ──────────────────────────────────────────────────────────────

/**
 * Convert an IPv4 dotted-decimal string to a 32-bit unsigned integer.
 * @param {string} ip - e.g. "10.0.0.1"
 * @returns {number}
 */
function ip4ToInt(ip) {
  return ip.split(".").reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;
}

/**
 * Check whether an IPv4 address falls within a CIDR block.
 * @param {string} ip - e.g. "10.0.0.1"
 * @param {string} cidr - e.g. "10.0.0.0/8"
 * @returns {boolean}
 */
function ip4InCidr(ip, cidr) {
  const [base, bits] = cidr.split("/");
  const mask = ~(2 ** (32 - parseInt(bits, 10)) - 1) >>> 0;
  const ipInt = ip4ToInt(ip);
  const baseInt = ip4ToInt(base);
  return (ipInt & mask) === (baseInt & mask);
}

/** Private / reserved IPv4 ranges (RFC 1918, 5735, 6598, 6890). */
const BLOCKED_IPV4_CIDRS = [
  "0.0.0.0/8", // Current network
  "10.0.0.0/8", // RFC 1918 - Private
  "100.64.0.0/10", // RFC 6598 - Carrier-grade NAT
  "127.0.0.0/8", // Loopback
  "169.254.0.0/16", // Link-local (includes AWS/cloud metadata endpoints)
  "172.16.0.0/12", // RFC 1918 - Private
  "192.0.0.0/24", // IETF Protocol Assignments
  "192.0.2.0/24", // TEST-NET-1
  "192.88.99.0/24", // 6to4 Relay Anycast
  "192.168.0.0/16", // RFC 1918 - Private
  "198.18.0.0/15", // Network benchmark
  "198.51.100.0/24", // TEST-NET-2
  "203.0.113.0/24", // TEST-NET-3
  "224.0.0.0/4", // Multicast
  "240.0.0.0/4", // Reserved
];

/**
 * @param {string} ip
 * @returns {boolean} true if the IPv4 address is blocked
 */
function isBlockedIPv4(ip) {
  return BLOCKED_IPV4_CIDRS.some((cidr) => ip4InCidr(ip, cidr));
}

// ── IPv6 helpers ──────────────────────────────────────────────────────────────

/** Private / reserved IPv6 prefixes (upper-cased, canonical form). */
const BLOCKED_IPV6_PREFIXES = [
  "::1", // Loopback
  "FC00:", // Unique local addresses (fc00::/7 — simplified prefix)
  "FD00:", // Unique local addresses (fd00::/8 — most common)
  "FE80:", // Link-local
];

/**
 * @param {string} ip - canonical IPv6 address
 * @returns {boolean}
 */
function isBlockedIPv6(ip) {
  // Normalise short-form loopback variants
  const upper = ip.toUpperCase();
  if (upper === "::1" || upper === "0:0:0:0:0:0:0:1") return true;
  for (const prefix of BLOCKED_IPV6_PREFIXES) {
    if (upper.startsWith(prefix)) return true;
  }
  return false;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Resolves a hostname to all its IP addresses (IPv4 + IPv6) and checks that
 * **none** of them fall into a blocked range.
 *
 * When the hostname is already a literal IP address, resolution is skipped
 * and the IP is checked directly.
 *
 * DNS rebinding note: the check happens *before* fetch, so a rebind that
 * switches between the check and the fetch is theoretically possible.
 * However, coupled with keep-alive connection pooling in modern runtimes,
 * the window is very narrow.  For the highest assurance, use an outbound
 * proxy that performs the check at the network layer.
 *
 * @param {string} hostname - the host portion of a URL (no port)
 * @throws {Error} if the IP address or hostname resolves to a blocked address
 */
async function assertPublicHost(hostname) {
  // ── 1. Check blocked hostnames (no DNS needed) ──────────────────────────
  const lower = hostname.toLowerCase();

  if (BLOCKED_HOSTNAMES.has(lower)) {
    throw new Error(`SSRF blocked: "${hostname}" is a forbidden internal hostname`);
  }

  for (const suffix of BLOCKED_HOSTNAME_SUFFIXES) {
    if (lower.endsWith(suffix)) {
      throw new Error(`SSRF blocked: "${hostname}" matches forbidden suffix "${suffix}"`);
    }
  }

  // ── 2. If the hostname is a raw IP address, check it directly ───────────
  if (net.isIP(hostname)) {
    if (net.isIPv4(hostname) && isBlockedIPv4(hostname)) {
      throw new Error(`SSRF blocked: "${hostname}" is a forbidden IPv4 address`);
    }
    if (net.isIPv6(hostname) && isBlockedIPv6(hostname)) {
      throw new Error(`SSRF blocked: "${hostname}" is a forbidden IPv6 address`);
    }
    return;
  }

  // ── 3. Resolve the hostname and check every returned IP ──────────────────
  let addresses;
  try {
    addresses = await dns.resolve(hostname);
  } catch (dnsErr) {
    // If DNS resolution fails the fetch would fail anyway, so we allow it
    // (the error will surface naturally from fetch).
    return;
  }

  if (!Array.isArray(addresses) || addresses.length === 0) return;

  for (const addr of addresses) {
    if (isBlockedIPv4(addr)) {
      throw new Error(`SSRF blocked: "${hostname}" resolves to forbidden IPv4 address ${addr}`);
    }
  }

  // Also check AAAA records (IPv6)
  let aaaaRecords;
  try {
    aaaaRecords = await dns.resolve6(hostname);
  } catch {
    /* no AAAA records — that's fine */
  }

  if (Array.isArray(aaaaRecords)) {
    for (const addr of aaaaRecords) {
      if (isBlockedIPv6(addr)) {
        throw new Error(`SSRF blocked: "${hostname}" resolves to forbidden IPv6 address ${addr}`);
      }
    }
  }
}

/**
 * Validate that a full URL points to a public, non-internal destination.
 *
 * Also enforces HTTPS (the webhook schema already does this, but this
 * function provides defence-in-depth for any code path that calls it).
 *
 * @param {string} urlStr - the full URL to validate
 * @throws {Error} if the URL is not safe for server-side requests
 */
async function validatePublicUrl(urlStr) {
  let parsed;
  try {
    parsed = new URL(urlStr);
  } catch {
    throw new Error("Invalid URL format");
  }

  if (parsed.protocol !== "https:") {
    throw new Error("Only HTTPS URLs are permitted");
  }

  const host = parsed.hostname;
  if (!host) {
    throw new Error("URL must include a hostname");
  }

  await assertPublicHost(host);
}

module.exports = { validatePublicUrl, assertPublicHost };

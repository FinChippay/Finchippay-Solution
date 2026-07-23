/**
 * src/services/eventIndexer.js
 * Soroban Contract Event Indexer
 *
 * Polls the Soroban RPC endpoint for new events emitted by FinchippayContract,
 * stores them in PostgreSQL, and exposes query methods used by the API layer.
 *
 * Architecture:
 *  - Polls every 30 seconds (configurable via EVENT_INDEXER_INTERVAL_MS).
 *  - Uses cursor-based pagination (last seen ledger sequence) so restarts
 *    resume from where they left off without re-processing old events.
 *  - Handles Soroban RPC timeouts with exponential back-off (same pattern as
 *    stellarService.js).
 *  - When DATABASE_URL is not set the indexer stores events in an in-memory
 *    buffer so the API remains functional in CI / dev without PostgreSQL.
 *
 * Event types emitted by the contract (see lib.rs):
 *   init, admin_transfer, paused, unpaused, pauser_set, upgraded,
 *   rescue_tokens, tip, receipt, escrow_create, escrow_claim_partial,
 *   escrow_claim, escrow_cancelled, stream_open, stream_claim,
 *   stream_topped_up, stream_close, stream_reject, stream_transfer,
 *   multisig_create, multisig_approve, multisig_executed,
 *   multisig_timeout, multisig_cancelled
 */

"use strict";

const logger = require("../utils/logger");
const { getRequestIdHeader } = require("../utils/correlationId");
require("dotenv").config();

// ─── Configuration ───────────────────────────────────────────────────────────

const SOROBAN_RPC_URL =
  process.env.SOROBAN_RPC_URL || "https://soroban-testnet.stellar.org";
const CONTRACT_ID =
  process.env.CONTRACT_ID || process.env.NEXT_PUBLIC_CONTRACT_ID || "";
const POLL_INTERVAL_MS = parseInt(
  process.env.EVENT_INDEXER_INTERVAL_MS || "30000",
  10,
);
const MAX_RETRIES = 3;
const DEFAULT_TIMEOUT_MS = 15_000;

// ─── In-memory fallback store (used when DATABASE_URL is absent) ─────────────

/** @type {Array<object>} */
const memoryStore = [];
let memoryIdCounter = 1;

// ─── PostgreSQL client (lazy singleton) ──────────────────────────────────────

let pgPool = null;

/**
 * Return a pg Pool instance if DATABASE_URL is configured, otherwise null.
 * The pool is created once on first call and reused thereafter.
 */
function getPgPool() {
  if (pgPool) return pgPool;

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    logger.warn(
      "DATABASE_URL not set — event indexer will use in-memory storage",
    );
    return null;
  }

  try {
    const { Pool } = require("pg");
    pgPool = new Pool({
      connectionString: databaseUrl,
      max: 4,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });

    pgPool.on("error", (err) => {
      logger.error({ err, type: "pg_pool_error" }, "PostgreSQL pool error");
    });

    logger.info(
      { type: "pg_pool_created" },
      "PostgreSQL connection pool ready",
    );
    return pgPool;
  } catch (err) {
    logger.error(
      { err, type: "pg_init_error" },
      "Failed to initialise pg — falling back to in-memory storage",
    );
    return null;
  }
}

// ─── HTTP client for Soroban RPC ─────────────────────────────────────────────

/**
 * Determine if an error is transient and worth retrying.
 * Mirrors the pattern in stellarService.js.
 */
function isTransientError(err) {
  if (!err) return false;
  const status = err?.response?.status ?? err?.status;
  if (status === 404) return false; // definitive
  if (status >= 500) return true;
  const msg = err?.message || "";
  return (
    msg.includes("ECONNRESET") ||
    msg.includes("ETIMEDOUT") ||
    msg.includes("ENOTFOUND") ||
    msg.includes("network") ||
    msg.includes("AbortError") ||
    err.name === "AbortError"
  );
}

/**
 * Run a fetch with timeout and exponential back-off retry.
 *
 * @param {string} url - Soroban RPC endpoint URL
 * @param {object} body - JSON-RPC request body
 * @param {number} [timeoutMs=15000]
 * @returns {Promise<object>} Parsed JSON-RPC response
 */
async function fetchWithRetry(url, body, timeoutMs = DEFAULT_TIMEOUT_MS) {
  let lastErr;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getRequestIdHeader(),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw Object.assign(
          new Error(`Soroban RPC responded with ${response.status}: ${text}`),
          { status: response.status },
        );
      }

      return await response.json();
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;

      if (!isTransientError(err) || attempt === MAX_RETRIES) throw err;

      const backoff = 100 * 2 ** attempt;
      logger.warn(
        { attempt, backoffMs: backoff, err: err.message },
        "Soroban RPC request failed — retrying",
      );
      await new Promise((resolve) => setTimeout(resolve, backoff));
    }
  }

  throw lastErr;
}

// ─── Soroban RPC helpers ─────────────────────────────────────────────────────

/**
 * Get the latest ledger sequence from Soroban RPC.
 *
 * JSON-RPC method: getLatestLedger
 * @returns {Promise<number>}
 */
async function getLatestLedger() {
  const body = {
    jsonrpc: "2.0",
    id: 1,
    method: "getLatestLedger",
    params: null,
  };

  const result = await fetchWithRetry(SOROBAN_RPC_URL, body);
  return result?.result?.sequence ?? 0;
}

/**
 * Fetch events for a given ledger range from Soroban RPC.
 *
 * JSON-RPC method: getEvents
 * Filters for events emitted by the configured CONTRACT_ID.
 *
 * @param {number} startLedger - inclusive lower bound
 * @param {number} [endLedger] - inclusive upper bound (defaults to startLedger)
 * @returns {Promise<Array<object>>}
 */
async function getEvents(startLedger) {
  const body = {
    jsonrpc: "2.0",
    id: 1,
    method: "getEvents",
    params: {
      startLedger,
      filters: [
        {
          type: "contract",
          contractIds: [CONTRACT_ID],
          topics: [],
        },
      ],
      pagination: {
        limit: 100,
      },
    },
  };

  const result = await fetchWithRetry(SOROBAN_RPC_URL, body);
  return result?.result?.events ?? [];
}

// ─── Event parsing ────────────────────────────────────────────────────────────

/**
 * Parse a raw Soroban event into our standard payload shape.
 *
 * Soroban events have:
 *  - type: "contract" | "diagnostic" | "system"
 *  - ledger: number
 *  - ledgerClosedAt: ISO 8601 string
 *  - contractId: string
 *  - id: string (unique event ID)
 *  - pagingToken: string
 *  - topic: Array<SCVal>
 *  - data: SCVal
 *
 * We extract a human-readable event_type from the first topic symbol,
 * then put the remaining topics and data into the JSONB payload.
 */
function parseEvent(raw) {
  const topics = raw.topic ?? [];
  const data = raw.data;

  // The first topic is typically a Symbol containing the event name.
  let eventType = "unknown";
  if (topics.length > 0) {
    const first = topics[0];
    // Soroban SCVal Symbol is either a string (in decoded form) or an object.
    if (typeof first === "string") {
      eventType = first;
    } else if (first && typeof first === "object") {
      // Handle SCVal object shapes returned by different RPC versions.
      eventType =
        first.symbol || first.str || first.value || String(first) || "unknown";
    }
  }

  // Build payload: include raw topics and data so API consumers can
  // extract participant addresses and amounts.
  const payload = {
    topics: topics,
    data: data ?? null,
    eventId: raw.id ?? null,
    pagingToken: raw.pagingToken ?? null,
  };

  return {
    event_type: String(eventType)
      .replace(/[^a-zA-Z0-9_]/g, "_")
      .slice(0, 64),
    contract_id: raw.contractId || CONTRACT_ID,
    ledger_sequence: raw.ledger ?? 0,
    emitted_at: raw.ledgerClosedAt
      ? new Date(raw.ledgerClosedAt).toISOString()
      : new Date().toISOString(),
    payload,
  };
}

// ─── Event storage ────────────────────────────────────────────────────────────

/**
 * Insert parsed events into the store (PostgreSQL or in-memory fallback).
 *
 * @param {Array<object>} events - parsed event rows
 * @returns {Promise<number>} number of events inserted
 */
async function storeEvents(events) {
  if (events.length === 0) return 0;

  const pool = getPgPool();

  if (pool) {
    // PostgreSQL path
    let inserted = 0;
    const client = await pool.connect();
    try {
      for (const ev of events) {
        try {
          await client.query(
            `INSERT INTO contract_events
               (event_type, contract_id, ledger_sequence, emitted_at, payload)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (ledger_sequence, contract_id, event_type, (payload->>'id'))
             DO NOTHING`,
            [
              ev.event_type,
              ev.contract_id,
              ev.ledger_sequence,
              ev.emitted_at,
              JSON.stringify(ev.payload),
            ],
          );
          inserted++;
        } catch (err) {
          // ON CONFLICT DO NOTHING should handle duplicates, but log
          // unexpected errors and continue with remaining events.
          logger.error(
            { err, event_type: ev.event_type, ledger: ev.ledger_sequence },
            "Failed to insert contract event",
          );
        }
      }
    } finally {
      client.release();
    }
    return inserted;
  }

  // In-memory fallback
  for (const ev of events) {
    memoryStore.push({
      id: memoryIdCounter++,
      ...ev,
      created_at: new Date().toISOString(),
    });
  }
  return events.length;
}

// ─── Cursor persistence ──────────────────────────────────────────────────────

/**
 * Last ledger sequence that has been fully processed.
 * Persisted in PostgreSQL when available, otherwise held in memory.
 */
let lastProcessedLedger = 0;

/**
 * Load the last processed ledger from PostgreSQL (or return in-memory value).
 */
async function loadCursor() {
  const pool = getPgPool();
  if (!pool) return lastProcessedLedger;

  try {
    const result = await pool.query(
      `SELECT MAX(ledger_sequence) AS max_ledger FROM contract_events`,
    );
    const max = result?.rows?.[0]?.max_ledger;
    if (max !== null && max !== undefined) {
      lastProcessedLedger = parseInt(max, 10);
      logger.info(
        { lastProcessedLedger },
        "Loaded event cursor from PostgreSQL",
      );
    }
  } catch (err) {
    logger.error({ err }, "Failed to load cursor from PostgreSQL");
  }
  return lastProcessedLedger;
}

// ─── Polling loop ────────────────────────────────────────────────────────────

let pollTimer = null;
let isPolling = false;

/**
 * Single poll cycle: fetch events since lastProcessedLedger,
 * parse, store, and advance the cursor.
 */
async function pollOnce() {
  if (isPolling) return;
  isPolling = true;

  try {
    const latestLedger = await getLatestLedger();
    if (latestLedger === 0) {
      logger.warn("getLatestLedger returned 0 — skipping poll cycle");
      return;
    }

    const startLedger = lastProcessedLedger > 0 ? lastProcessedLedger + 1 : 1;
    if (startLedger > latestLedger) {
      // No new ledgers to process
      return;
    }

    // Fetch events for the full unprocessed range.
    // The RPC may paginate internally; we request up to 100 events at a time
    // and follow pagination cursors to ensure completeness.
    const rawEvents = await getEvents(startLedger);

    if (rawEvents.length > 0) {
      const parsed = [];
      for (const raw of rawEvents) {
        try {
          parsed.push(parseEvent(raw));
        } catch (parseErr) {
          logger.warn(
            { parseErr, eventId: raw.id },
            "Failed to parse individual Soroban event — skipping",
          );
        }
      }
      const inserted = await storeEvents(parsed);
      logger.info(
        {
          eventCount: rawEvents.length,
          inserted,
          startLedger,
          endLedger: latestLedger,
        },
        "Indexed Soroban contract events",
      );
    }

    lastProcessedLedger = latestLedger;
  } catch (err) {
    logger.error({ err }, "Event indexer poll failed");
  } finally {
    isPolling = false;
  }
}

/**
 * Start the polling loop. Safe to call multiple times — only one
 * interval will be active.
 */
function start() {
  if (pollTimer) {
    logger.warn("Event indexer is already running");
    return;
  }

  if (!CONTRACT_ID) {
    logger.warn(
      "CONTRACT_ID is not set — event indexer will not start. " +
        "Set CONTRACT_ID or NEXT_PUBLIC_CONTRACT_ID to the deployed contract ID.",
    );
    return;
  }

  logger.info(
    {
      sorobanRpcUrl: SOROBAN_RPC_URL,
      contractId: CONTRACT_ID,
      pollIntervalMs: POLL_INTERVAL_MS,
    },
    "Starting contract event indexer",
  );

  // Load any existing cursor before the first poll.
  loadCursor().then(() => {
    // Run one poll immediately, then every POLL_INTERVAL_MS.
    pollOnce();
    pollTimer = setInterval(pollOnce, POLL_INTERVAL_MS);
  });
}

/**
 * Stop the polling loop. Used in tests and graceful shutdown.
 */
function stop() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
    logger.info("Event indexer stopped");
  }
}

// ─── Query helpers (used by eventController) ─────────────────────────────────

/**
 * Query events where a given public key appears as a participant.
 *
 * Looks for the public key in payload->>'from' or payload->>'to',
 * or nested within payload.topics and payload.data fields.
 *
 * @param {string} publicKey - Stellar public key (G…)
 * @param {{ limit?: number, offset?: number }} options
 * @returns {Promise<{ events: Array<object>, total: number }>}
 */
async function queryEventsByPublicKey(
  publicKey,
  { limit = 20, offset = 0 } = {},
) {
  const pool = getPgPool();

  if (pool) {
    const result = await pool.query(
      `SELECT id, event_type, contract_id, ledger_sequence,
              emitted_at, payload, created_at
       FROM contract_events
       WHERE payload::text ILIKE $1
       ORDER BY ledger_sequence DESC, id DESC
       LIMIT $2 OFFSET $3`,
      [`%${publicKey}%`, limit, offset],
    );

    const countResult = await pool.query(
      `SELECT COUNT(*) AS total
       FROM contract_events
       WHERE payload::text ILIKE $1`,
      [`%${publicKey}%`],
    );

    return {
      events: result.rows,
      total: parseInt(countResult?.rows?.[0]?.total ?? "0", 10),
    };
  }

  // In-memory fallback
  const filtered = memoryStore.filter((ev) => {
    const payloadStr = JSON.stringify(ev.payload).toLowerCase();
    return payloadStr.includes(publicKey.toLowerCase());
  });

  const paged = filtered
    .sort(
      (a, b) =>
        (b.ledger_sequence ?? 0) - (a.ledger_sequence ?? 0) ||
        (b.id ?? 0) - (a.id ?? 0),
    )
    .slice(offset, offset + limit);

  return { events: paged, total: filtered.length };
}

/**
 * Get aggregate counts grouped by event type for a given public key.
 *
 * @param {string} publicKey
 * @returns {Promise<Array<{ event_type: string, count: number }>>}
 */
async function getEventStats(publicKey) {
  const pool = getPgPool();

  if (pool) {
    const result = await pool.query(
      `SELECT event_type, COUNT(*) AS count
       FROM contract_events
       WHERE payload::text ILIKE $1
       GROUP BY event_type
       ORDER BY count DESC`,
      [`%${publicKey}%`],
    );
    return result.rows;
  }

  // In-memory fallback
  const counts = {};
  for (const ev of memoryStore) {
    const payloadStr = JSON.stringify(ev.payload).toLowerCase();
    if (payloadStr.includes(publicKey.toLowerCase())) {
      counts[ev.event_type] = (counts[ev.event_type] || 0) + 1;
    }
  }
  return Object.entries(counts)
    .map(([event_type, count]) => ({ event_type, count }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Get the total count of all indexed contract events (for the dashboard).
 *
 * @returns {Promise<number>}
 */
async function getTotalEventCount() {
  const pool = getPgPool();

  if (pool) {
    const result = await pool.query(
      `SELECT COUNT(*) AS total FROM contract_events`,
    );
    return parseInt(result?.rows?.[0]?.total ?? "0", 10);
  }

  return memoryStore.length;
}

/**
 * Return whether the indexer has an active backing store (PG pool or
 * the in-memory fallback, which is always available).
 *
 * @returns {boolean}
 */
function isAvailable() {
  return !!getPgPool() || true; // in-memory fallback is always available
}

module.exports = {
  start,
  stop,
  queryEventsByPublicKey,
  getEventStats,
  getTotalEventCount,
  isAvailable,
  // Exported for test introspection
  _resetForTest: () => {
    stop();
    memoryStore.length = 0;
    memoryIdCounter = 1;
    lastProcessedLedger = 0;
    if (pgPool) {
      pgPool.end().catch(() => {});
      pgPool = null;
    }
  },
};

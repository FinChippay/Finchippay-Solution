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
 *  - Idempotent: uses ingestion_batches table to track processed ledgers
 *    and prevents double-counting with unique constraints.
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
const metrics = require("./metricsService");
const { getRequestIdHeader } = require("../utils/correlationId");
const { parseEvent } = require("./eventParser");
require("dotenv").config();

// ─── Configuration ───────────────────────────────────────────────────────────

const SOROBAN_RPC_URL = process.env.SOROBAN_RPC_URL || "https://soroban-testnet.stellar.org";
const CONTRACT_ID = process.env.CONTRACT_ID || process.env.NEXT_PUBLIC_CONTRACT_ID || "";
const POLL_INTERVAL_MS = parseInt(process.env.EVENT_INDEXER_INTERVAL_MS || "30000", 10);
const MAX_RETRIES = 3;
const DEFAULT_TIMEOUT_MS = 15_000;

// ─── In-memory fallback store (used when DATABASE_URL is absent) ─────────────

/** @type {Array<object>} */
const memoryStore = [];
let memoryIdCounter = 1;

/** @type {Array<object>} */
const memoryBatches = [];
let memoryBatchIdCounter = 1;

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
    logger.warn("DATABASE_URL not set — event indexer will use in-memory storage");
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

    logger.info({ type: "pg_pool_created" }, "PostgreSQL connection pool ready");
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
        throw Object.assign(new Error(`Soroban RPC responded with ${response.status}: ${text}`), {
          status: response.status,
        });
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
async function getEvents(startLedger, endLedger) {
  const body = {
    jsonrpc: "2.0",
    id: 1,
    method: "getEvents",
    params: {
      startLedger,
      endLedger: endLedger || undefined,
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

// ─── Batch persistence (atomic) ──────────────────────────────────────────────

/**
 * Save a batch of events atomically with the cursor.
 * Uses a transaction to ensure both the events and the batch record are saved together.
 *
 * @param {Array<object>} events - Parsed event rows
 * @param {number} startLedger - First ledger in this batch
 * @param {number} endLedger - Last ledger in this batch
 * @param {string} cursor - RPC cursor string
 * @returns {Promise<number>} Number of events inserted
 */
async function saveBatchAtomically(events, startLedger, endLedger, cursor) {
  if (events.length === 0) {
    // Even with no events, we need to save the cursor to track progress
    const pool = getPgPool();
    if (pool) {
      const client = await pool.connect();
      try {
        await client.query(
          `INSERT INTO ingestion_batches (start_ledger, end_ledger, cursor, event_count, metadata)
           VALUES ($1, $2, $3, $4, $5)`,
          [startLedger, endLedger, cursor, 0, JSON.stringify({ note: "no events in range" })],
        );
        logger.debug({ startLedger, endLedger, cursor }, "Saved empty batch cursor");
      } finally {
        client.release();
      }
    } else {
      // In-memory fallback
      memoryBatches.push({
        id: memoryBatchIdCounter++,
        start_ledger: startLedger,
        end_ledger: endLedger,
        cursor: cursor,
        event_count: 0,
        processed_at: new Date().toISOString(),
      });
    }
    return 0;
  }

  const pool = getPgPool();

  if (pool) {
    // PostgreSQL path with transaction
    const client = await pool.connect();
    let insertedCount = 0;

    try {
      await client.query("BEGIN");

      // Insert all events with ON CONFLICT
      for (const ev of events) {
        const result = await client.query(
          `INSERT INTO contract_events
             (event_type, contract_id, ledger_sequence, emitted_at,
              from_addr, to_addr, amount_raw, payload,
              txn_hash, op_index)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           ON CONFLICT (ledger_sequence, COALESCE(txn_hash, ''), COALESCE(op_index, -1), event_type)
           DO NOTHING
           RETURNING id`,
          [
            ev.event_type,
            ev.contract_id,
            ev.ledger_sequence,
            ev.emitted_at,
            ev.from_addr || null,
            ev.to_addr || null,
            ev.amount_raw || null,
            JSON.stringify(ev.payload),
            ev.txn_hash || null,
            ev.op_index !== undefined && ev.op_index !== null ? ev.op_index : -1,
          ],
        );
        if (result.rows.length > 0) {
          insertedCount++;
        }
      }

      // Insert the batch record (cursor) - this is the atomic commit point
      await client.query(
        `INSERT INTO ingestion_batches (start_ledger, end_ledger, cursor, event_count, metadata)
         VALUES ($1, $2, $3, $4, $5)`,
        [startLedger, endLedger, cursor, insertedCount, JSON.stringify({})],
      );

      await client.query("COMMIT");
      logger.debug({ startLedger, endLedger, cursor, insertedCount }, "Batch saved atomically");
      return insertedCount;
    } catch (err) {
      await client.query("ROLLBACK");
      logger.error({ err, startLedger, endLedger }, "Failed to save batch atomically");
      throw err;
    } finally {
      client.release();
    }
  }

  // In-memory fallback
  for (const ev of events) {
    memoryStore.push({
      id: memoryIdCounter++,
      ...ev,
      created_at: new Date().toISOString(),
    });
  }

  memoryBatches.push({
    id: memoryBatchIdCounter++,
    start_ledger: startLedger,
    end_ledger: endLedger,
    cursor: cursor,
    event_count: events.length,
    processed_at: new Date().toISOString(),
  });

  return events.length;
}

/**
 * Store parsed events (legacy wrapper for tests).
 * Wraps saveBatchAtomically for backward compatibility.
 *
 * @param {Array<object>} events - Parsed event rows
 * @returns {Promise<number>} Number of events inserted
 */
async function storeEvents(events) {
  if (events.length === 0) return 0;

  // Get the max ledger from events
  let maxLedger = 0;
  let minLedger = Infinity;
  for (const ev of events) {
    if (ev.ledger_sequence > maxLedger) maxLedger = ev.ledger_sequence;
    if (ev.ledger_sequence < minLedger) minLedger = ev.ledger_sequence;
  }

  // For in-memory fallback, check for duplicates before inserting
  const pool = getPgPool();
  if (!pool) {
    // In-memory deduplication
    let insertedCount = 0;
    for (const ev of events) {
      // Check if event already exists in memory store
      const exists = memoryStore.some((existing) => {
        return (
          existing.ledger_sequence === ev.ledger_sequence &&
          existing.event_type === ev.event_type &&
          existing.txn_hash === ev.txn_hash &&
          existing.op_index === ev.op_index
        );
      });

      if (!exists) {
        memoryStore.push({
          id: memoryIdCounter++,
          ...ev,
          created_at: new Date().toISOString(),
        });
        insertedCount++;
      }
    }
    return insertedCount;
  }

  // Use a generic cursor for PostgreSQL
  const cursor = `store-${Date.now()}-${minLedger}-${maxLedger}`;

  // Save atomically
  const inserted = await saveBatchAtomically(events, minLedger, maxLedger, cursor);
  return inserted;
}
// ─── Cursor persistence ──────────────────────────────────────────────────────

/**
 * Last ledger sequence that has been fully processed.
 * Persisted in PostgreSQL when available, otherwise held in memory.
 */
let lastProcessedLedger = 0;

/**
 * Load the last processed ledger from the ingestion_batches table.
 * This is more reliable than MAX(ledger_sequence) because it tracks
 * ledgers with no events as well.
 */
async function loadCursor() {
  const pool = getPgPool();
  if (!pool) return lastProcessedLedger;

  try {
    // Primary: load from ingestion_batches
    const result = await pool.query(
      `SELECT COALESCE(MAX(end_ledger), 0) AS max_ledger FROM ingestion_batches`,
    );
    const max = result?.rows?.[0]?.max_ledger;
    if (max !== null && max !== undefined && parseInt(max, 10) > 0) {
      lastProcessedLedger = parseInt(max, 10);
      logger.info({ lastProcessedLedger }, "Loaded event cursor from ingestion_batches");
      return lastProcessedLedger;
    }

    // Fallback: if no batches exist, use MAX(ledger_sequence)
    const fallbackResult = await pool.query(
      `SELECT MAX(ledger_sequence) AS max_ledger FROM contract_events`,
    );
    const fallbackMax = fallbackResult?.rows?.[0]?.max_ledger;
    if (fallbackMax !== null && fallbackMax !== undefined) {
      lastProcessedLedger = parseInt(fallbackMax, 10);
      logger.info({ lastProcessedLedger }, "Loaded cursor from contract_events (fallback)");

      // Create an initial batch record to bootstrap the new system
      if (lastProcessedLedger > 0) {
        try {
          await pool.query(
            `INSERT INTO ingestion_batches (start_ledger, end_ledger, cursor, event_count, metadata)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (cursor) DO NOTHING`,
            [
              1,
              lastProcessedLedger,
              `initial-${lastProcessedLedger}`,
              0,
              JSON.stringify({ note: "initial migration bootstrap" }),
            ],
          );
          logger.info({ lastProcessedLedger }, "Bootstrapped initial batch record");
        } catch (bootstrapErr) {
          logger.warn({ bootstrapErr }, "Failed to bootstrap initial batch record");
        }
      }
    }
  } catch (err) {
    logger.error({ err }, "Failed to load cursor from PostgreSQL");
  }
  return lastProcessedLedger;
}

/**
 * Get the last processed ledger (memory value).
 * Used by the replay function.
 */
function getLastProcessedLedger() {
  return lastProcessedLedger;
}

// ─── Replay functionality ────────────────────────────────────────────────────

/**
 * Replay ingestion from a specific ledger.
 * This allows re-processing history without duplication.
 *
 * @param {number} fromLedger - Ledger to start replay from
 * @param {number} [toLedger] - Ledger to end replay at (default: latest)
 * @returns {Promise<{ processed: number, inserted: number, duplicates: number }>}
 */
async function replayFrom(fromLedger, toLedger) {
  if (!fromLedger || fromLedger < 1) {
    throw new Error("fromLedger must be a positive integer");
  }

  const pool = getPgPool();

  // If toLedger not provided, get the latest
  if (!toLedger) {
    toLedger = await getLatestLedger();
    if (toLedger === 0) {
      throw new Error("Failed to get latest ledger from Soroban RPC");
    }
  }

  if (fromLedger > toLedger) {
    throw new Error(`fromLedger (${fromLedger}) cannot be greater than toLedger (${toLedger})`);
  }

  logger.info({ fromLedger, toLedger, usingPostgres: !!pool }, "Starting replay from ledger range");

  let totalProcessed = 0;
  let totalInserted = 0;
  let totalDuplicates = 0;

  // Process in chunks to avoid overwhelming the system
  const CHUNK_SIZE = 100;
  let currentLedger = fromLedger;

  while (currentLedger <= toLedger) {
    const chunkEnd = Math.min(currentLedger + CHUNK_SIZE - 1, toLedger);

    try {
      // Fetch events for this chunk
      const rawEvents = await getEvents(currentLedger, chunkEnd);

      // Parse events
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

      // Save the batch atomically (works for both PG and SQLite)
      const cursor = `replay-${currentLedger}-${chunkEnd}`;

      // Use saveBatchAtomically - it handles both PG and SQLite
      const inserted = await saveBatchAtomically(parsed, currentLedger, chunkEnd, cursor);

      totalProcessed += rawEvents.length;
      totalInserted += inserted;
      totalDuplicates += parsed.length - inserted;

      logger.info(
        {
          currentLedger,
          chunkEnd,
          rawEvents: rawEvents.length,
          inserted,
          duplicates: parsed.length - inserted,
        },
        "Replay chunk processed",
      );

      // Update the cursor for metrics
      lastProcessedLedger = Math.max(lastProcessedLedger, chunkEnd);
    } catch (err) {
      logger.error({ err, currentLedger, chunkEnd }, "Replay failed for chunk");
      throw err;
    }

    currentLedger = chunkEnd + 1;
  }

  logger.info(
    { fromLedger, toLedger, totalProcessed, totalInserted, totalDuplicates },
    "Replay completed",
  );

  return {
    processed: totalProcessed,
    inserted: totalInserted,
    duplicates: totalDuplicates,
    fromLedger,
    toLedger,
  };
}

// ─── Polling loop ────────────────────────────────────────────────────────────

let pollTimer = null;
let isPolling = false;

/**
 * Single poll cycle: fetch events since lastProcessedLedger,
 * parse, store, and advance the cursor atomically.
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

    // Backlog signal: how far behind the network we are right now (#272).
    // Recorded before the early return so a caught-up indexer reports 0 rather
    // than holding its last non-zero value.
    metrics.contractEventIndexerLagLedgers.set(
      lastProcessedLedger > 0 ? Math.max(0, latestLedger - lastProcessedLedger) : 0,
    );

    const startLedger = lastProcessedLedger > 0 ? lastProcessedLedger + 1 : 1;
    if (startLedger > latestLedger) {
      // No new ledgers to process
      return;
    }

    // Fetch events for the full unprocessed range
    const rawEvents = await getEvents(startLedger, latestLedger);

    // Parse events
    const parsed = [];
    for (const raw of rawEvents) {
      try {
        parsed.push(parseEvent(raw));
      } catch (parseErr) {
        metrics.contractEventsProcessedTotal.inc({ outcome: "parse_failed" });
        logger.warn(
          { parseErr, eventId: raw.id },
          "Failed to parse individual Soroban event — skipping",
        );
      }
    }

    // Save atomically with cursor
    const cursor = `ledger-${startLedger}-${latestLedger}`;
    const inserted = await saveBatchAtomically(parsed, startLedger, latestLedger, cursor);

    // Update metrics
    metrics.contractEventsProcessedTotal.inc({ outcome: "indexed" }, inserted);
    metrics.contractEventsProcessedTotal.inc({ outcome: "duplicate" }, parsed.length - inserted);

    logger.info(
      {
        eventCount: rawEvents.length,
        inserted,
        duplicates: parsed.length - inserted,
        startLedger,
        endLedger: latestLedger,
      },
      "Indexed Soroban contract events",
    );

    // Update last processed ledger
    lastProcessedLedger = latestLedger;

    // Push notifications for the events users care about (payment received,
    // stream opened, escrow activity). Required lazily and wrapped so the
    // indexer keeps its cursor moving even if notification delivery breaks.
    if (parsed.length > 0) {
      try {
        const pushNotifier = require("./pushNotifier");
        await pushNotifier.notifyContractEvents(parsed);
      } catch (notifyErr) {
        logger.warn({ notifyErr }, "Failed to dispatch push notifications for indexed events");
      }
    }
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

/**
 * Whether the indexer has completed startup — either its polling interval is
 * active, or it intentionally never started because CONTRACT_ID is unset.
 * Used by the startup probe so deployments without a configured contract
 * aren't stuck waiting for an indexer that will never run.
 * @returns {boolean}
 */
function isRunning() {
  return !!pollTimer || !CONTRACT_ID;
}

// ─── Query helpers (used by eventController) ─────────────────────────────────

/**
 * Query events filtered by event type for a given public key.
 *
 * @param {string} publicKey - Stellar public key (G…)
 * @param {string} eventType - event type to filter by
 * @param {{ limit?: number, offset?: number, since?: string }} options
 * @returns {Promise<{ events: Array<object>, total: number }>}
 */
async function queryEventsByType(publicKey, eventType, { limit = 20, offset = 0, since } = {}) {
  const pool = getPgPool();

  if (pool) {
    let where = `payload::text ILIKE $1 AND event_type = $2`;
    const params = [`%${publicKey}%`, eventType];

    if (since) {
      where += ` AND emitted_at >= $${params.length + 1}`;
      params.push(since);
    }

    const result = await pool.query(
      `SELECT id, event_type, contract_id, ledger_sequence,
              emitted_at, payload, created_at
       FROM contract_events
       WHERE ${where}
       ORDER BY ledger_sequence DESC, id DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset],
    );

    const countResult = await pool.query(
      `SELECT COUNT(*) AS total
       FROM contract_events
       WHERE ${where}`,
      params,
    );

    return {
      events: result.rows,
      total: parseInt(countResult?.rows?.[0]?.total ?? "0", 10),
    };
  }

  // In-memory fallback
  const filtered = memoryStore.filter((ev) => {
    const payloadStr = JSON.stringify(ev.payload).toLowerCase();
    const match = payloadStr.includes(publicKey.toLowerCase()) && ev.event_type === eventType;
    if (!match) return false;
    if (since && new Date(ev.emitted_at) < new Date(since)) return false;
    return true;
  });

  const paged = filtered
    .sort(
      (a, b) => (b.ledger_sequence ?? 0) - (a.ledger_sequence ?? 0) || (b.id ?? 0) - (a.id ?? 0),
    )
    .slice(offset, offset + limit);

  return { events: paged, total: filtered.length };
}

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
async function queryEventsByPublicKey(publicKey, { limit = 20, offset = 0, since } = {}) {
  const pool = getPgPool();

  if (pool) {
    let where = `payload::text ILIKE $1`;
    const params = [`%${publicKey}%`];

    if (since) {
      where += ` AND emitted_at >= $${params.length + 1}`;
      params.push(since);
    }

    const result = await pool.query(
      `SELECT id, event_type, contract_id, ledger_sequence,
              emitted_at, from_addr, to_addr, amount_raw, payload, created_at
       FROM contract_events
       WHERE ${where}
       ORDER BY ledger_sequence DESC, id DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset],
    );

    const countResult = await pool.query(
      `SELECT COUNT(*) AS total
       FROM contract_events
       WHERE ${where}`,
      params,
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
      (a, b) => (b.ledger_sequence ?? 0) - (a.ledger_sequence ?? 0) || (b.id ?? 0) - (a.id ?? 0),
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
    const result = await pool.query(`SELECT COUNT(*) AS total FROM contract_events`);
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
  isRunning,
  replayFrom,
  getLastProcessedLedger,
  getLatestLedger,
  storeEvents,
  queryEventsByPublicKey,
  queryEventsByType,
  getEventStats,
  getTotalEventCount,
  isAvailable,
  // Exported for test introspection
  _resetForTest: () => {
    stop();
    memoryStore.length = 0;
    memoryIdCounter = 1;
    memoryBatches.length = 0;
    memoryBatchIdCounter = 1;
    lastProcessedLedger = 0;
    if (pgPool) {
      pgPool.end().catch(() => {});
      pgPool = null;
    }
  },
};

/**
 * admin/replay.js
 * Admin endpoint for replaying event ingestion from a specific ledger.
 * 
 * This allows administrators to re-process historical events without
 * duplication, useful for fixing issues or backfilling data.
 */

const express = require('express');
const router = express.Router();
const logger = require('../../utils/logger');
const eventIndexer = require('../../services/eventIndexer');

/**
 * POST /admin/replay
 * 
 * Trigger a replay of event ingestion from a specific ledger.
 * 
 * Request body:
 * {
 *   fromLedger: number (required) - Ledger to start replay from
 *   toLedger: number (optional) - Ledger to end replay at (default: latest)
 *   dryRun: boolean (optional) - If true, only simulate and return stats
 * }
 * 
 * Response:
 * {
 *   success: boolean,
 *   message: string,
 *   data: {
 *     fromLedger: number,
 *     toLedger: number,
 *     processed: number,
 *     inserted: number,
 *     duplicates: number,
 *     durationMs: number
 *   }
 * }
 */
router.post('/replay', async (req, res) => {
  try {
    const { fromLedger, toLedger, dryRun = false } = req.body;

    // Validate required parameters
    if (!fromLedger) {
      return res.status(400).json({
        success: false,
        error: 'fromLedger is required',
        message: 'Please provide fromLedger in the request body'
      });
    }

    if (typeof fromLedger !== 'number' || fromLedger < 1) {
      return res.status(400).json({
        success: false,
        error: 'Invalid fromLedger',
        message: 'fromLedger must be a positive integer'
      });
    }

    if (toLedger !== undefined && (typeof toLedger !== 'number' || toLedger < 1)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid toLedger',
        message: 'toLedger must be a positive integer'
      });
    }

    if (toLedger !== undefined && toLedger < fromLedger) {
      return res.status(400).json({
        success: false,
        error: 'Invalid range',
        message: 'toLedger must be greater than or equal to fromLedger'
      });
    }

    logger.info(
      { fromLedger, toLedger, dryRun, ip: req.ip },
      'Admin replay requested'
    );

    // If dry run, just return what would happen
    if (dryRun) {
      const latestLedger = await eventIndexer.getLatestLedger 
        ? await eventIndexer.getLatestLedger() 
        : null;
      
      const lastProcessed = eventIndexer.getLastProcessedLedger();
      
      return res.json({
        success: true,
        message: 'Dry run completed',
        data: {
          fromLedger,
          toLedger: toLedger || latestLedger || 'unknown',
          lastProcessedLedger: lastProcessed,
          estimatedEvents: 'unknown (dry run only)',
          dryRun: true
        }
      });
    }

    // Execute the replay
    const startTime = Date.now();
    const result = await eventIndexer.replayFrom(fromLedger, toLedger);
    const durationMs = Date.now() - startTime;

    logger.info(
      { 
        fromLedger, 
        toLedger: result.toLedger,
        processed: result.processed,
        inserted: result.inserted,
        duplicates: result.duplicates,
        durationMs,
        ip: req.ip 
      },
      'Admin replay completed'
    );

    res.json({
      success: true,
      message: 'Replay completed successfully',
      data: {
        ...result,
        durationMs
      }
    });

  } catch (error) {
    logger.error(
      { 
        error: error.message, 
        stack: error.stack,
        body: req.body,
        ip: req.ip 
      },
      'Admin replay failed'
    );

    res.status(500).json({
      success: false,
      error: 'Replay failed',
      message: error.message
    });
  }
});

/**
 * GET /admin/replay/status
 * 
 * Get the current status of the event indexer and last processed ledger.
 */
router.get('/replay/status', async (req, res) => {
  try {
    const lastProcessed = eventIndexer.getLastProcessedLedger();
    const isRunning = eventIndexer.isRunning();
    
    // Try to get latest ledger
    let latestLedger = null;
    try {
      const { getLatestLedger } = require('../../services/eventIndexer');
      if (typeof getLatestLedger === 'function') {
        latestLedger = await getLatestLedger();
      }
    } catch (err) {
      // RPC might not be available
    }

    res.json({
      success: true,
      data: {
        lastProcessedLedger: lastProcessed,
        latestLedger: latestLedger,
        isRunning: isRunning,
        lag: latestLedger !== null && lastProcessed > 0 
          ? Math.max(0, latestLedger - lastProcessed) 
          : null
      }
    });

  } catch (error) {
    logger.error({ error: error.message }, 'Failed to get replay status');
    res.status(500).json({
      success: false,
      error: 'Failed to get status',
      message: error.message
    });
  }
});

module.exports = router;

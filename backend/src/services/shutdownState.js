/**
 * src/services/shutdownState.js
 * Process-wide flag flipped when a shutdown signal (SIGTERM/SIGINT) is
 * received, so the readiness probe can fail immediately during the drain
 * window — Kubernetes stops routing traffic to the pod without waiting for
 * a dependency probe to time out first.
 */

"use strict";

let shuttingDown = false;

function markShuttingDown() {
  shuttingDown = true;
}

function isShuttingDown() {
  return shuttingDown;
}

/**
 * Reset the flag to its initial (not shutting down) state. Only meaningful
 * in tests — a real process never un-shuts-down.
 */
function resetForTests() {
  shuttingDown = false;
}

module.exports = { markShuttingDown, isShuttingDown, resetForTests };

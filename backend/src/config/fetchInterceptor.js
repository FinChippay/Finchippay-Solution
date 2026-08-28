"use strict";

const { getCorrelationId } = require("../middleware/correlationId");

const originalFetch = global.fetch;

if (typeof originalFetch === "function" && !originalFetch.__correlationPatched) {
  const patchedFetch = function correlationAwareFetch(input, init = {}) {
    const correlationId = getCorrelationId();
    if (correlationId) {
      const headers = new Headers(init.headers || (input && input.headers) || {});
      headers.set("X-Correlation-ID", correlationId);
      init = { ...init, headers };
    }
    return originalFetch(input, init);
  };
  patchedFetch.__correlationPatched = true;
  global.fetch = patchedFetch;
}

module.exports = {};

/**
 * src/config/axiosInterceptors.js
 * Global axios request interceptor that forwards the current correlation ID
 * (X-Request-ID) on every outbound HTTP call.
 *
 * Must be required early (before any axios usage).
 */

"use strict";

const axios = require("axios");
const { getRequestId } = require("../utils/correlationId");

// Global request interceptor — adds X-Request-ID when a correlation
// context is active (i.e. inside an HTTP request handler).
axios.interceptors.request.use((config) => {
  const requestId = getRequestId();
  if (requestId) {
    config.headers.set("X-Request-ID", requestId);
  }
  return config;
});

module.exports = { axios };

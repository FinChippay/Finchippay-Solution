/**
 * src/config/axiosInterceptors.js
 * Global axios request interceptor that forwards the current correlation ID
 * (X-Request-ID) on every outbound HTTP call.
 *
 * Must be required early (before any axios usage).
 */

"use strict";

const axios = require("axios");
const { getRequestIdHeader } = require("../utils/correlationId");

// Global request interceptor — forwards correlation headers when a
// request context is active (i.e. inside an HTTP request handler).
axios.interceptors.request.use((config) => {
  const headers = getRequestIdHeader();
  for (const [key, value] of Object.entries(headers)) {
    config.headers.set(key, value);
  }
  return config;
});

module.exports = { axios };

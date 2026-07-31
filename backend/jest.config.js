/**
 * jest.config.js
 * Jest runs on defaults except for a global setup step that provisions and
 * migrates a fresh SQLite test database before the suite (see
 * jest.globalSetup.js).
 */

"use strict";

module.exports = {
  testEnvironment: "node",
  globalSetup: "<rootDir>/jest.globalSetup.js",
};

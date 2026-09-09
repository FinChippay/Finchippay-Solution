/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: "node",
  roots: ["<rootDir>/__tests__"],
  testMatch: ["**/*.test.js"],
  testPathIgnorePatterns: ["/node_modules/"],
  // The SDK's CJS build pulls an ESM-only dependency (@noble/hashes) that Jest
  // cannot transform. Suites that merely load the SDK transitively get this
  // stub; suites that need real SDK behavior mock it per-test (jest.mock wins
  // over moduleNameMapper).
  moduleNameMapper: {
    "^@stellar/stellar-sdk$": "<rootDir>/__tests__/stellarSdkStub.js",
  },
  collectCoverageFrom: [
    "src/**/*.js",
    "!src/server.js",
    "!src/turretsServer.js",
    "!src/swagger.js",
    "!src/db/migrate-status.js",
    "!**/node_modules/**",
  ],
  coverageDirectory: "coverage",
  coverageReporters: ["text", "text-summary", "html", "lcov", "json-summary"],
  // Thresholds sit just below the coverage actually achieved by the suite
  // (measured: statements 65%, branches 51%, functions 69%, lines 66%) so the
  // gate is enforced without failing on day one. Raise them as coverage grows.
  coverageThreshold: {
    global: {
      branches: 48,
      functions: 65,
      lines: 62,
      statements: 62,
    },
  },
  globalSetup: "<rootDir>/jest.globalSetup.js",
  setupFilesAfterEnv: [],
  verbose: true,
  clearMocks: true,
  restoreMocks: true,
  maxWorkers: "50%",
};

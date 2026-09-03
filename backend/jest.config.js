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
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 75,
      lines: 80,
      statements: 80,
    },
  },
  globalSetup: "<rootDir>/jest.globalSetup.js",
  setupFilesAfterEnv: [],
  verbose: true,
  clearMocks: true,
  restoreMocks: true,
  maxWorkers: "50%",
};

/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: "node",
  roots: ["<rootDir>/__tests__"],
  testMatch: ["**/*.test.js"],
  testPathIgnorePatterns: ["/node_modules/"],
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

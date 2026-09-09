import type { Config } from "jest";

const config: Config = {
  testEnvironment: "<rootDir>/jest.environment.ts",
  transform: { "^.+\\.tsx?$": ["ts-jest", { tsconfig: { jsx: "react-jsx" } }] },
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/$1",
    "^@trezor/connect$": "<rootDir>/__tests__/mocks/trezor-connect.ts",
    "^@stellar/stellar-sdk$": "<rootDir>/../node_modules/@stellar/stellar-sdk/dist/stellar-sdk.js",
  },
  // jest.setup.ts imports @testing-library/jest-dom (which needs `expect`), so
  // it must run after the framework is installed — setupFilesAfterEnv, not
  // setupFiles.
  setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
  testPathIgnorePatterns: ["<rootDir>/e2e/", "<rootDir>/__tests__/mocks/"],
  collectCoverageFrom: [
    "components/**/*.tsx",
    "pages/**/*.tsx",
    "lib/**/*.ts",
    "hooks/**/*.ts",
    "!lib/stellar.ts",
    "!lib/api.ts",
  ],
  // Thresholds sit just below the coverage actually achieved by the suite
  // (measured: statements 54%, branches 43%, functions 49%, lines 56%) so the
  // gate is enforced without failing on day one. Raise them as coverage grows.
  coverageThreshold: {
    global: {
      lines: 52,
      branches: 40,
      functions: 45,
      statements: 50,
    },
  },
};

export default config;

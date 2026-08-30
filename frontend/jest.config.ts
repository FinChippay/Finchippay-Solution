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
  testPathIgnorePatterns: ["<rootDir>/e2e/"],
  collectCoverageFrom: [
    "components/**/*.tsx",
    "pages/**/*.tsx",
    "lib/**/*.ts",
    "hooks/**/*.ts",
    "!lib/stellar.ts",
    "!lib/api.ts",
  ],
  coverageThreshold: {
    global: {
      lines: 80,
      branches: 70,
      functions: 75,
      statements: 80,
    },
  },
};

export default config;

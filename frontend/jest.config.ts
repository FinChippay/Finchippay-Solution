import type { Config } from "jest";

const config: Config = {
  testEnvironment: "<rootDir>/jest.environment.ts",
  transform: { "^.+\\.tsx?$": ["ts-jest", { tsconfig: { jsx: "react-jsx" } }] },
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/$1",
    "^@stellar/stellar-sdk$": "<rootDir>/../node_modules/@stellar/stellar-sdk/lib/index.js",
  },
  // jest.setup.ts imports @testing-library/jest-dom (which needs `expect`), so
  // it must run after the framework is installed — setupFilesAfterEnv, not
  // setupFiles.
  setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
  testPathIgnorePatterns: ["<rootDir>/e2e/"],
  collectCoverageFrom: [
    "components/RecurringPayments.tsx",
    "pages/escrow.tsx",
    "components/TradeForm.tsx",
  ],
  coverageThreshold: {
    global: {
      lines: 70,
    },
    "./components/RecurringPayments.tsx": {
      lines: 70,
    },
    "./pages/escrow.tsx": {
      lines: 70,
    },
    "./components/TradeForm.tsx": {
      lines: 70,
    },
  },
};

export default config;

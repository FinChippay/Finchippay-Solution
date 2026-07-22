import type { Config } from "jest";

const config: Config = {
  testEnvironment: "jsdom",
  transform: { "^.+\\.tsx?$": ["ts-jest", { tsconfig: { jsx: "react-jsx" } }] },
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/$1",
    "^@stellar/stellar-sdk$": "<rootDir>/node_modules/@stellar/stellar-sdk/lib/index.js",
  },
  setupFiles: ["<rootDir>/jest.setup.ts"],
  setupFilesAfterEnv: ["@testing-library/jest-dom"],
  testPathIgnorePatterns: ["<rootDir>/e2e/"],
  collectCoverageFrom: [
    "components/RecurringPayments.tsx",
    "pages/escrow.tsx",
    "components/TradeForm.tsx",
  ],
  coverageThreshold: {
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

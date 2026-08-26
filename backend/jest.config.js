module.exports = {
  testEnvironment: "node",
  transformIgnorePatterns: ["node_modules/(?!(stellar-sdk|@stellar/stellar-sdk|@noble/hashes)/)"],
  transform: {
    "^.+\\.(js|jsx)$": "babel-jest",
  },
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
  },
};

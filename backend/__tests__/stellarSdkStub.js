/* eslint-env jest */
"use strict";

/**
 * Shared @stellar/stellar-sdk stub registered via jest moduleNameMapper.
 *
 * The SDK's CJS build pulls an ESM-only dependency (`@noble/hashes`) that Jest
 * cannot transform, so suites that load the SDK transitively (via
 * src/config/stellar.js or the service layer) get this stub instead of the
 * real package. Suites that need precise SDK behavior still call
 * `jest.mock("@stellar/stellar-sdk", ...)` with their own factory, which takes
 * precedence over the mapper.
 */
module.exports = require("./turretsSdkStub");

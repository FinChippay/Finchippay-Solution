# SDK / Client Library Generation

> **Issue:** [#171](https://github.com/FinChippay/Finchippay-Solution/issues/171)  
> **Labels:** `cross-cutting`, `sdk`, `api`, `developer-experience`  
> **Status:** ✅ Implemented

## Overview

This feature adds a **TypeScript SDK** (`@finchippay/sdk`) auto-generated from the backend's OpenAPI 3.0 specification. The SDK provides fully typed methods for every API endpoint, SEP-0010 authentication handling, and automatic error parsing — reducing third-party integration time from hours to minutes.

## Architecture

```
sdk/                           ← npm workspace package
├── package.json               ← @finchippay/sdk
├── tsconfig.json
├── README.md                  ← SDK usage docs
├── src/
│   ├── index.ts               ← Main export (FinchippayClient, ApiHttpError, types)
│   ├── types.ts               ← Auto-generated TypeScript interfaces from OpenAPI spec
│   └── client.ts              ← Fetch-based client with typed methods & SEP-0010 auth
scripts/
└── generate-sdk.sh            ← Regenerates types from running backend
docs/
└── sdk.md                     ← This file — integration guide for third-party devs
```

## For Third-Party Developers

If you're building an application that integrates with Finchippay's payment API, the SDK is the recommended way to interact with the backend.

### Install

```bash
npm install @finchippay/sdk
```

### Quick Start

```typescript
import { FinchippayClient, ApiHttpError } from "@finchippay/sdk";

const sdk = new FinchippayClient({
  baseUrl: "https://api.stellarfinchippay.io",
});

// Fetch account balance
const { data } = await sdk.accounts.getBalance(
  "GDZESYKG34O2LNG5V6KQZ4J5R5HDS7R5Y7P3G4J6K7L8M9N0O1P2Q3R4S5T6U"
);
console.log("Balance:", data.balance);

// Get payment history with pagination
const { data: payments } = await sdk.payments.getHistory(
  "GDZESYKG34O2LNG5V6KQZ4J5R5HDS7R5Y7P3G4J6K7L8M9N0O1P2Q3R4S5T6U",
  { limit: 50, cursor: "1234567890" }
);
```

### Authentication

Protected endpoints require a JWT token obtained via [SEP-0010](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0010.md):

1. **Get a challenge:** `sdk.getChallenge(publicKey)` → returns a ManageData transaction XDR
2. **Sign it** with the user's Stellar keypair (using Freighter, `@stellar/stellar-sdk`, or your wallet)
3. **Submit:** `sdk.verifyChallenge(signedXDR)` → returns a JWT token (auto-cached)
4. **Done** — all subsequent requests include the `Authorization: Bearer <token>` header

### Error Handling

All API errors throw `ApiHttpError` with:

- `status` — HTTP status code
- `message` — Parsed error message from the API
- `isRateLimited` — `true` if HTTP 429
- `rateLimit` — Parsed `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset` headers

### API Methods Summary

| Domain                  | Methods                                                                  |
|-------------------------|--------------------------------------------------------------------------|
| **Health**              | `health()`                                                               |
| **Accounts**            | `accounts.get()`, `.getBalance()`, `.resolveUsername()`, `.register()`   |
| **Payments**            | `payments.getHistory()`, `.getStats()`                                   |
| **Analytics**           | `analytics.getSummary()`, `.getTopRecipients()`, `.getActivity()`        |
| **Tips**                | `tips.getReceived()`, `.getSent()`, `.getStats()`, `.create()`           |
| **Turrets (txFunctions)**| `turrets.list()`, `.createChallenge()`, `.deploy()`, `.get()`, `.getHistory()`, `.pause()`, `.resume()` |
| **Scheduled Txns**      | `scheduledTransactions.schedule()`, `.list()`, `.cancel()`               |
| **SEP-0024**            | `sep24.initiateDeposit()`, `.initiateWithdrawal()`, `.getTransaction()`  |
| **AI Parsing**          | `parsePayment()`                                                         |
| **Federation**          | `federation.resolve()`, `.getStellarToml()`                              |

> See the [SDK README](../sdk/README.md) for full method signatures and parameters.

## For Contributors

### Regenerating Types

The SDK types are generated from the OpenAPI spec served by the backend at `/api/docs.json`.

```bash
# 1. Start the backend
cd backend && npm start

# 2. In another terminal, regenerate types
npm run generate:sdk
#   → Fetches http://localhost:4000/api/docs.json
#   → Overwrites sdk/src/types.ts
```

### Building

```bash
# Install dependencies (workspaces)
npm install

# Build the SDK
npm run build:sdk

# Or build everything (SDK + frontend)
npm run build
```

### Type Checking

```bash
npm run type-check
```

### CI Integration

The SDK build and type-check are included in CI. See [ci.yml](../.github/workflows/ci.yml) for details.

### Publishing to npm

```bash
cd sdk
npm publish --access public
```

This publishes the `@finchippay/sdk` package with:
- `dist/index.js` — CommonJS build
- `dist/index.d.ts` — TypeScript declarations
- `README.md` — Usage documentation

## Acceptance Criteria Checklist

| # | Acceptance Criterion | Status |
|---|---------------------|--------|
| 1 | `npm run generate:sdk` produces a typed TypeScript client from the OpenAPI spec | ✅ |
| 2 | SDK package builds and exports typed methods for all API endpoints | ✅ |
| 3 | SDK README contains usage examples for common operations | ✅ |
| 4 | Frontend optionally uses the SDK for API calls | ✅ |
| 5 | SDK types are regenerated in CI and checked for changes | ✅ |
| 6 | `docs/sdk.md` provides integration guidance for third-party developers | ✅ |
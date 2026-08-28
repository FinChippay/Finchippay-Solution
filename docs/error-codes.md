<!--
  GENERATED FILE — do not edit by hand.
  Source: shared/errorCodes.js
  Regenerate: node scripts/generate-error-codes-doc.js
  Generated: 2026-08-22 20:20:00 UTC
-->

# Error codes

> **Last generated:** 2026-08-22 20:20:00 UTC

Every error Finchippay returns carries a machine-readable code from a single
catalogue shared by the contract, the API, and the frontend. This document is
generated from that catalogue, so it cannot drift from the code.

**89 codes** are defined in [`shared/errorCodes.js`](../shared/errorCodes.js).

---

## Table of contents

- [Response format](#response-format)
- [Correlation IDs](#correlation-ids)
- [Naming conventions](#naming)
- [Category overview](#category-overview)
- [Common errors](#common-errors)
- [Using the catalogue](#using-the-catalogue)
  - [Backend](#backend)
  - [Frontend](#frontend)
  - [Contract](#contract)
- [Full catalogue](#catalogue)
  - [`AUTH_*` — Authentication and authorization](#auth-authentication-and-authorization)
  - [`CONTRACT_*` — Soroban contract](#contract-soroban-contract)
  - [`GEN_*` — Generic](#gen-generic)
  - [`PAY_*` — Payments and transactions](#pay-payments-and-transactions)
  - [`RATE_*` — Rate limiting](#rate-rate-limiting)
  - [`RES_*` — Resource lifecycle](#res-resource-lifecycle)
  - [`SRV_*` — Server and infrastructure](#srv-server-and-infrastructure)
  - [`TOKEN_*` — Legacy aliases](#token-legacy-aliases)
  - [`VAL_*` — Request validation](#val-request-validation)
  - [`WALLET_*` — Browser wallet](#wallet-browser-wallet)

---

## Response format

Every API error uses the same body:

```json
{
  "error": {
    "code": "VAL_INVALID_PUBLIC_KEY",
    "message": "Invalid Stellar public key format.",
    "correlationId": "6f1a2b3c-4d5e-6f70-8192-a3b4c5d6e7f8",
    "details": { "field": "destination" }
  }
}
```

| Field | Always present | Description |
| --- | --- | --- |
| `error.code` | yes | Machine-readable code from this catalogue. Switch on this, never on the message. |
| `error.message` | yes | Human-readable description. Written for developers; the frontend maps codes to user-facing copy separately. |
| `error.correlationId` | on API responses | Matches the `X-Request-ID` response header and the `correlationId` field in the server logs. |
| `error.details` | no | Code-specific context: the offending field, the received value, and so on. |

The `error` key is at the top level, so consumers written against the original
`{ error }` contract keep working.

### Correlation IDs

The API generates a UUID for every request, or adopts an inbound
`X-Request-ID` header if the caller supplies one. That value is:

1. returned in the `X-Request-ID` response header,
2. embedded as `error.correlationId` in error bodies,
3. logged with every log line for the request.

Quoting one ID therefore locates the failure across all three. See
[`backend/src/utils/correlationId.js`](../backend/src/utils/correlationId.js).

## Naming

Codes are `CATEGORY_SPECIFIC`. The category prefix determines the owning
layer, so the layer never has to be repeated in the code itself — use
`getErrorLayer(code)` to resolve it programmatically.

**Message template placeholders:** Some messages contain placeholders that are
replaced at runtime with context-specific values:

| Placeholder | Meaning |
| --- | --- |
| `<token>` | An authentication token value |
| `<destination>` | A Stellar address or account ID |
| `<amount>` | A numeric amount in stroops or lumen |
| `<field>` | A request body field name |
| `<limit>` | A maximum allowed value (rate, size, count) |

## Category overview

| Prefix | Layer | Codes | Meaning |
| --- | --- | --- | --- |
| `AUTH_*` | api | 7 | Authentication and authorization |
| `CONTRACT_*` | contract | 29 | Soroban contract |
| `GEN_*` | shared | 3 | Generic |
| `PAY_*` | api | 9 | Payments and transactions |
| `RATE_*` | api | 3 | Rate limiting |
| `RES_*` | api | 7 | Resource lifecycle |
| `SRV_*` | api | 6 | Server and infrastructure |
| `TOKEN_*` | api | 1 | Legacy aliases |
| `VAL_*` | api | 17 | Request validation |
| `WALLET_*` | frontend | 7 | Browser wallet |

## Common errors

The following **10 error codes** are the most commonly
encountered by API consumers. Check this section first when troubleshooting.

| Code | HTTP | Message |
| --- | --- | --- |
| `AUTH_MISSING_TOKEN` | 401 | Authentication token is required. |
| `AUTH_EXPIRED_TOKEN` | 401 | Token has expired. Please re-authenticate. |
| `AUTH_INVALID_TOKEN` | 401 | Token is invalid or malformed. |
| `VAL_INVALID_PUBLIC_KEY` | 400 | Invalid Stellar public key format. |
| `VAL_INVALID_AMOUNT` | 400 | Amount must be a positive number. |
| `VAL_MISSING_FIELD` | 400 | Required field is missing. |
| `RES_NOT_FOUND` | 404 | The requested resource was not found. |
| `RATE_LIMITED_GLOBAL` | 429 | Too many requests. Please try again later. |
| `PAY_INSUFFICIENT_BALANCE` | 400 | Insufficient balance for this transaction. |
| `GEN_NETWORK_ERROR` | n/a | Network error. Please check your connection. |

### Example response (auth)

```json
{
  "error": {
    "code": "AUTH_MISSING_TOKEN",
    "message": "Authentication token is required.",
    "correlationId": "6f1a2b3c-4d5e-6f70-8192-a3b4c5d6e7f8"
  }
}
```

### Example response (validation)

```json
{
  "error": {
    "code": "VAL_INVALID_PUBLIC_KEY",
    "message": "Invalid Stellar public key format.",
    "correlationId": "6f1a2b3c-4d5e-6f70-8192-a3b4c5d6e7f8"
  }
}
```

### Example response (not found)

```json
{
  "error": {
    "code": "RES_NOT_FOUND",
    "message": "The requested resource was not found.",
    "correlationId": "6f1a2b3c-4d5e-6f70-8192-a3b4c5d6e7f8"
  }
}
```

### Example response (rate limited)

```json
{
  "error": {
    "code": "RATE_LIMITED_GLOBAL",
    "message": "Too many requests. Please try again later.",
    "correlationId": "6f1a2b3c-4d5e-6f70-8192-a3b4c5d6e7f8"
  }
}
```

### Example response (payment failure)

```json
{
  "error": {
    "code": "PAY_INSUFFICIENT_BALANCE",
    "message": "Insufficient balance for this transaction.",
    "correlationId": "6f1a2b3c-4d5e-6f70-8192-a3b4c5d6e7f8"
  }
}
```

## Using the catalogue

### Backend

Prefer [`backend/src/utils/errorResponse.js`](../backend/src/utils/errorResponse.js),
which resolves the HTTP status from the catalogue so a status can never drift
from its code:

```js
const { sendError, createError } = require("../utils/errorResponse");

// Respond immediately.
return sendError(res, "VAL_INVALID_PUBLIC_KEY", {
  details: { field: "destination" },
});

// Or hand off to the global error handler.
return next(createError("RES_NOT_FOUND"));
```

### Frontend

[`frontend/lib/handleError.ts`](../frontend/lib/handleError.ts) maps a code to
user-facing copy and a recovery action:

```ts
const handled = await handleApiError(response);
// handled.title        -> "Not enough balance"
// handled.userMessage  -> "Your balance will not cover this payment ..."
// handled.action       -> { kind: "fund", label: "Add funds" }
// handled.correlationId -> "6f1a2b3c-..."
```

Recovery actions are `retry`, `reconnect`, `reauth`, `fix_input`,
`wait`, `fund`, `contact_support`, and `none`.

### Contract

The Soroban contract's `ContractError` enum returns numeric variants. The
`ContractError` column below gives the variant each `CONTRACT_*` code maps
from; `getContractErrorCode(n)` performs the lookup.

## Catalogue

### `AUTH_*` — Authentication and authorization

Layer: **api**

Authentication and authorization failures: missing, expired, or invalid tokens, forbidden access, and SEP-0010 challenge verification.

| Code | HTTP | Message |
| --- | --- | --- |
| `AUTH_CHALLENGE_FAILED` | 401 | SEP-0010 challenge verification failed. |
| `AUTH_EXPIRED_TOKEN` | 401 | Token has expired. Please re-authenticate. |
| `AUTH_FORBIDDEN` | 403 | You do not have permission to access this resource. |
| `AUTH_INVALID_TOKEN` | 401 | Token is invalid or malformed. |
| `AUTH_INVALID_WEBHOOK_SIGNATURE` | 401 | Webhook signature verification failed. |
| `AUTH_MISSING_HEADER` | 401 | Missing or invalid Authorization header. Expected 'Bearer <token>'. |
| `AUTH_MISSING_TOKEN` | 401 | Authentication token is required. |

### `CONTRACT_*` — Soroban contract

Layer: **contract**

Soroban smart contract errors: authorization, state, arithmetic, and transfer failures returned by on-chain contract calls.

| Code | HTTP | ContractError | Message |
| --- | --- | --- | --- |
| `CONTRACT_ALREADY_INITIALIZED` | 409 | 1 | Contract is already initialized. |
| `CONTRACT_ALREADY_SIGNED` | 409 | 10 | Address has already approved this proposal. |
| `CONTRACT_BATCH_TOO_LARGE` | 400 | 14 | Batch size exceeds maximum allowed. |
| `CONTRACT_DUPLICATE_SIGNER` | 400 | 15 | Duplicate signer in signers list. |
| `CONTRACT_EMERGENCY_WITHDRAWAL_NOT_READY` | 409 | 19 | Emergency withdrawal is not ready yet. |
| `CONTRACT_EXCESSIVE_AMOUNT_IN` | 400 | 23 | Required swap input exceeds the maximum allowed amount. |
| `CONTRACT_INDEX_FULL` | 409 | 18 | Recipient index is full. |
| `CONTRACT_INSUFFICIENT_FUNDS` | 400 | 11 | Insufficient deposited funds. |
| `CONTRACT_INVALID_FEE_BPS` | 400 | 24 | Swap fee exceeds the maximum allowed basis points. |
| `CONTRACT_INVALID_PATH` | 400 | 21 | Swap path is invalid. |
| `CONTRACT_INVALID_STATE` | 409 | 6 | Operation not valid in the current state. |
| `CONTRACT_INVALID_THRESHOLD` | 400 | 8 | Signer list length does not match threshold. |
| `CONTRACT_LENGTH_MISMATCH` | 400 | 9 | Array lengths do not match. |
| `CONTRACT_NON_POSITIVE_AMOUNT` | 400 | 3 | Amount must be strictly positive. |
| `CONTRACT_NOT_ADMIN_SIGNER` | 403 | 20 | Caller is not an authorized admin signer. |
| `CONTRACT_NOT_FOUND` | 404 | 5 | The contract resource (escrow, stream, proposal) was not found. |
| `CONTRACT_OVERFLOW` | 500 | 7 | Arithmetic overflow in contract operation. |
| `CONTRACT_PAUSED` | 503 | 12 | Contract is temporarily paused. |
| `CONTRACT_PROPOSAL_ALREADY_EXECUTED` | 409 | 26 | Admin action proposal has already been executed. |
| `CONTRACT_PROPOSAL_EXPIRED` | 410 | 16 | Proposal has expired and can no longer be approved. |
| `CONTRACT_PROPOSAL_NOT_FOUND` | 404 | 25 | Admin action proposal was not found. |
| `CONTRACT_REENTRANT_CALL` | 409 | 28 | Reentrant contract call was blocked. |
| `CONTRACT_RELEASE_LEDGER_IN_PAST` | 400 | 4 | Release ledger must be in the future. |
| `CONTRACT_RELEASE_LEDGER_NOT_REACHED` | 409 | 27 | Release ledger has not been reached. |
| `CONTRACT_SELF_TRANSFER` | 400 | 13 | Cannot transfer to yourself. |
| `CONTRACT_SLIPPAGE_EXCEEDED` | 400 | 22 | Swap slippage limit was exceeded. |
| `CONTRACT_STALE_PATH` | 400 | 29 | Swap path is stale or has insufficient liquidity. |
| `CONTRACT_TRANSFER_FAILED` | 502 | 17 | Token transfer could not be verified on-chain. |
| `CONTRACT_UNAUTHORIZED` | 403 | 2 | You are not authorized for this action. |

### `GEN_*` — Generic

Layer: **shared**

Generic and catch-all errors: unexpected failures, network connectivity issues, and offline detection.

| Code | HTTP | Message |
| --- | --- | --- |
| `GEN_NETWORK_ERROR` | n/a | Network error. Please check your connection. |
| `GEN_OFFLINE` | n/a | You are offline. Please check your connection. |
| `GEN_UNKNOWN` | 500 | An unexpected error occurred. |

### `PAY_*` — Payments and transactions

Layer: **api**

Payment and transaction errors: building, signing, submitting, confirming, and balance-check failures through the Stellar network.

| Code | HTTP | Message |
| --- | --- | --- |
| `PAY_BUILD_FAILED` | 500 | Failed to build the payment transaction. |
| `PAY_CONFIRMATION_TIMEOUT` | 504 | Transaction confirmation timed out. |
| `PAY_DESTINATION_NOT_FUNDED` | 400 | Destination account does not exist. Send at least 1 XLM to create it. |
| `PAY_HORIZON_ERROR` | 502 | Stellar Horizon returned an error. |
| `PAY_INSUFFICIENT_BALANCE` | 400 | Insufficient balance for this transaction. |
| `PAY_INVALID_DESTINATION` | 400 | Invalid payment destination. |
| `PAY_SELF_PAYMENT` | 400 | Cannot send payment to your own wallet. |
| `PAY_SIGN_FAILED` | 400 | Failed to sign the transaction. |
| `PAY_SUBMIT_FAILED` | 502 | Failed to submit the transaction to the Stellar network. |

### `RATE_*` — Rate limiting

Layer: **api**

Rate limiting enforcement: requests throttled globally, per sensitive route, or per user account.

| Code | HTTP | Message |
| --- | --- | --- |
| `RATE_LIMITED_GLOBAL` | 429 | Too many requests. Please try again later. |
| `RATE_LIMITED_SENSITIVE` | 429 | Too many requests to sensitive routes. Please wait 1 minute. |
| `RATE_LIMITED_USER` | 429 | Too many requests from this account. |

### `RES_*` — Resource lifecycle

Layer: **api**

Resource lifecycle errors: resources not found, already exist (conflict), or are no longer available (gone).

| Code | HTTP | Message |
| --- | --- | --- |
| `RES_ACCOUNT_NOT_FOUND` | 404 | Account not found. It may not be funded yet. Use Friendbot on testnet. |
| `RES_CONFLICT` | 409 | Resource already exists. |
| `RES_GONE` | 410 | The resource is no longer available. |
| `RES_NOT_FOUND` | 404 | The requested resource was not found. |
| `RES_PUBLIC_KEY_CONFLICT` | 409 | Public key already registered to another username. |
| `RES_ROUTE_NOT_FOUND` | 404 | Route not found. |
| `RES_USERNAME_CONFLICT` | 409 | Username already registered. |

### `SRV_*` — Server and infrastructure

Layer: **api**

Server and infrastructure errors: internal failures, upstream unavailability, missing configuration, and unimplemented features.

| Code | HTTP | Message |
| --- | --- | --- |
| `SRV_AI_NOT_CONFIGURED` | 501 | AI payment parsing is not configured. |
| `SRV_FEDERATION_FAILED` | 502 | External federation resolution failed. |
| `SRV_HORIZON_UNAVAILABLE` | 502 | Stellar Horizon is temporarily unavailable. |
| `SRV_INTERNAL` | 500 | An internal server error occurred. |
| `SRV_METRICS_FAILED` | 500 | Failed to collect Prometheus metrics. |
| `SRV_NOT_IMPLEMENTED` | 501 | This feature is not yet implemented. |

### `TOKEN_*` — Legacy aliases

Layer: **api**

Legacy error code aliases maintained for backward compatibility with existing consumers.

| Code | HTTP | Message |
| --- | --- | --- |
| `TOKEN_EXPIRED` | 401 | Token has expired. Please refresh or re-authenticate. **Deprecated** -- use `AUTH_EXPIRED_TOKEN`. |

### `VAL_*` — Request validation

Layer: **api**

Request validation failures: malformed input, missing required fields, invalid formats, and constraint violations.

| Code | HTTP | Message |
| --- | --- | --- |
| `VAL_BODY_TOO_LARGE` | 413 | Request body exceeds the maximum allowed size. |
| `VAL_CONTENT_TYPE` | 415 | Content-Type must be application/json. |
| `VAL_INVALID_AMOUNT` | 400 | Amount must be a positive number. |
| `VAL_INVALID_CURSOR` | 400 | Cursor is malformed. Use a cursor returned by a previous page. |
| `VAL_INVALID_DATE` | 400 | Invalid date format. Provide a valid ISO 8601 date string. |
| `VAL_INVALID_FEDERATION_TYPE` | 400 | Invalid type parameter. Must be 'name' or 'id'. |
| `VAL_INVALID_JSON` | 400 | Request body contains invalid JSON. |
| `VAL_INVALID_LIMIT` | 400 | Limit must be a positive integer. |
| `VAL_INVALID_OFFSET` | 400 | Offset must be a non-negative integer. |
| `VAL_INVALID_PUBLIC_KEY` | 400 | Invalid Stellar public key format. |
| `VAL_INVALID_QUERY_PARAM` | 400 | A query parameter is missing or invalid. |
| `VAL_INVALID_STELLAR_ADDRESS` | 400 | Invalid Stellar address format. |
| `VAL_INVALID_URL` | 400 | Invalid URL format. |
| `VAL_INVALID_USERNAME` | 400 | Username must be 3–20 characters and contain only letters and numbers. |
| `VAL_MEMO_TOO_LONG` | 400 | Memo exceeds the maximum of 28 bytes. |
| `VAL_MISSING_FIELD` | 400 | Required field is missing. |
| `VAL_WEAK_SECRET` | 400 | Secret must be at least 8 characters for HMAC-SHA256 security. |

### `WALLET_*` — Browser wallet

Layer: **frontend**

Browser wallet (Freighter) interaction errors: not installed, not connected, rejected, locked, or network/account mismatches.

| Code | HTTP | Message |
| --- | --- | --- |
| `WALLET_ACCOUNT_MISMATCH` | n/a | The wallet's selected account differs from the active account in this app. |
| `WALLET_CONNECTION_REJECTED` | n/a | The connection request was rejected in the wallet. |
| `WALLET_LOCKED` | n/a | The wallet is locked. Unlock it and try again. |
| `WALLET_NETWORK_MISMATCH` | n/a | The wallet is on a different Stellar network than this app. Switch networks in the wallet. |
| `WALLET_NOT_CONNECTED` | n/a | No wallet is connected. Connect a wallet to continue. |
| `WALLET_NOT_INSTALLED` | n/a | Freighter is not installed. Install it from freighter.app. |
| `WALLET_SIGNATURE_REJECTED` | n/a | The transaction signature was rejected in the wallet. |

---

*Document auto-generated on 2026-08-22 20:20:00 UTC from [`shared/errorCodes.js`](../shared/errorCodes.js).*

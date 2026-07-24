<!--
  GENERATED FILE — do not edit by hand.
  Source: shared/errorCodes.js
  Regenerate: node scripts/generate-error-codes-doc.js
-->

# Error codes

Every error Finchippay returns carries a machine-readable code from a single
catalogue shared by the contract, the API, and the frontend. This document is
generated from that catalogue, so it cannot drift from the code.

**75 codes** are defined in [`shared/errorCodes.js`](../shared/errorCodes.js).

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

| Prefix | Layer | Codes | Meaning |
| --- | --- | --- | --- |
| `AUTH_*` | api | 6 | Authentication and authorization |
| `CONTRACT_*` | contract | 17 | Soroban contract |
| `GEN_*` | shared | 3 | Generic |
| `PAY_*` | api | 9 | Payments and transactions |
| `RATE_*` | api | 3 | Rate limiting |
| `RES_*` | api | 7 | Resource lifecycle |
| `SRV_*` | api | 6 | Server and infrastructure |
| `TOKEN_*` | api | 1 | Legacy aliases |
| `VAL_*` | api | 16 | Request validation |
| `WALLET_*` | frontend | 7 | Browser wallet |

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
// handled.title        → "Not enough balance"
// handled.userMessage  → "Your balance will not cover this payment ..."
// handled.action       → { kind: "fund", label: "Add funds" }
// handled.correlationId → "6f1a2b3c-..."
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

| Code | HTTP | Message |
| --- | --- | --- |
| `AUTH_CHALLENGE_FAILED` | 401 | SEP-0010 challenge verification failed. |
| `AUTH_EXPIRED_TOKEN` | 401 | Token has expired. Please re-authenticate. |
| `AUTH_FORBIDDEN` | 403 | You do not have permission to access this resource. |
| `AUTH_INVALID_TOKEN` | 401 | Token is invalid or malformed. |
| `AUTH_MISSING_HEADER` | 401 | Missing or invalid Authorization header. Expected 'Bearer <token>'. |
| `AUTH_MISSING_TOKEN` | 401 | Authentication token is required. |

### `CONTRACT_*` — Soroban contract

Layer: **contract**

| Code | HTTP | ContractError | Message |
| --- | --- | --- | --- |
| `CONTRACT_ALREADY_INITIALIZED` | 409 | 1 | Contract is already initialized. |
| `CONTRACT_ALREADY_SIGNED` | 409 | 10 | Address has already approved this proposal. |
| `CONTRACT_BATCH_TOO_LARGE` | 400 | 14 | Batch size exceeds maximum allowed. |
| `CONTRACT_DUPLICATE_SIGNER` | 400 | 15 | Duplicate signer in signers list. |
| `CONTRACT_INSUFFICIENT_FUNDS` | 400 | 11 | Insufficient deposited funds. |
| `CONTRACT_INVALID_STATE` | 409 | 6 | Operation not valid in the current state. |
| `CONTRACT_INVALID_THRESHOLD` | 400 | 8 | Signer list length does not match threshold. |
| `CONTRACT_LENGTH_MISMATCH` | 400 | 9 | Array lengths do not match. |
| `CONTRACT_NON_POSITIVE_AMOUNT` | 400 | 3 | Amount must be strictly positive. |
| `CONTRACT_NOT_FOUND` | 404 | 5 | The contract resource (escrow, stream, proposal) was not found. |
| `CONTRACT_OVERFLOW` | 500 | 7 | Arithmetic overflow in contract operation. |
| `CONTRACT_PAUSED` | 503 | 12 | Contract is temporarily paused. |
| `CONTRACT_PROPOSAL_EXPIRED` | 410 | 16 | Proposal has expired and can no longer be approved. |
| `CONTRACT_RELEASE_LEDGER_IN_PAST` | 400 | 4 | Release ledger must be in the future. |
| `CONTRACT_SELF_TRANSFER` | 400 | 13 | Cannot transfer to yourself. |
| `CONTRACT_TRANSFER_FAILED` | 502 | 17 | Token transfer could not be verified on-chain. |
| `CONTRACT_UNAUTHORIZED` | 403 | 2 | You are not authorized for this action. |

### `GEN_*` — Generic

Layer: **shared**

| Code | HTTP | Message |
| --- | --- | --- |
| `GEN_NETWORK_ERROR` | n/a | Network error. Please check your connection. |
| `GEN_OFFLINE` | n/a | You are offline. Please check your connection. |
| `GEN_UNKNOWN` | 500 | An unexpected error occurred. |

### `PAY_*` — Payments and transactions

Layer: **api**

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

| Code | HTTP | Message |
| --- | --- | --- |
| `RATE_LIMITED_GLOBAL` | 429 | Too many requests. Please try again later. |
| `RATE_LIMITED_SENSITIVE` | 429 | Too many requests to sensitive routes. Please wait 1 minute. |
| `RATE_LIMITED_USER` | 429 | Too many requests from this account. |

### `RES_*` — Resource lifecycle

Layer: **api**

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

| Code | HTTP | Message |
| --- | --- | --- |
| `TOKEN_EXPIRED` | 401 | Token has expired. Please refresh or re-authenticate. **Deprecated** — use `AUTH_EXPIRED_TOKEN`. |

### `VAL_*` — Request validation

Layer: **api**

| Code | HTTP | Message |
| --- | --- | --- |
| `VAL_BODY_TOO_LARGE` | 413 | Request body exceeds the maximum allowed size. |
| `VAL_CONTENT_TYPE` | 415 | Content-Type must be application/json. |
| `VAL_INVALID_AMOUNT` | 400 | Amount must be a positive number. |
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

| Code | HTTP | Message |
| --- | --- | --- |
| `WALLET_ACCOUNT_MISMATCH` | n/a | The wallet's selected account differs from the active account in this app. |
| `WALLET_CONNECTION_REJECTED` | n/a | The connection request was rejected in the wallet. |
| `WALLET_LOCKED` | n/a | The wallet is locked. Unlock it and try again. |
| `WALLET_NETWORK_MISMATCH` | n/a | The wallet is on a different Stellar network than this app. Switch networks in the wallet. |
| `WALLET_NOT_CONNECTED` | n/a | No wallet is connected. Connect a wallet to continue. |
| `WALLET_NOT_INSTALLED` | n/a | Freighter is not installed. Install it from freighter.app. |
| `WALLET_SIGNATURE_REJECTED` | n/a | The transaction signature was rejected in the wallet. |

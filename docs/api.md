# API Documentation — Finchippay Solution

**Base URL:** `http://localhost:4000` (default; override with `PORT`)

**Interactive docs:** [Swagger UI](http://localhost:4000/api/docs) · [OpenAPI JSON](http://localhost:4000/api/docs.json)

> **🎯 27 total endpoints** across Health, Auth, Federation, Accounts, Payments, Analytics, Tips, Turrets, Webhooks, AI Parsing, and Scheduled Transactions.

---

## Response conventions

Most JSON endpoints use one of these shapes:

**Success (typical)**
```json
{ "success": true, "data": { } }
```

**Success with message**
```json
{ "success": true, "data": { }, "message": "..." }
```

**Error (standardized — #169)**

All API errors now follow a canonical shape:
```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable message",
    "details": { ... }
  }
}
```

> **Note:** Legacy `{ "error": "message" }` shapes are being migrated. New code should expect the canonical shape above.

Some endpoints (health, federation, auth challenge, webhooks list) return a flat object without the `success` / `data` wrapper. Each route below shows the actual response shape.

**Authentication:** Account detail routes require a JWT from [SEP-0010 auth](#authentication). Send:

```
Authorization: Bearer <token>
```

---

## Error Codes Reference

All errors returned by the API use a machine-readable error code. The canonical registry is at `shared/errorCodes.js`.

### Authentication Errors (`AUTH_*`)

| Code | HTTP | Description |
|------|------|-------------|
| `AUTH_MISSING_TOKEN` | 401 | Authentication token is required. |
| `AUTH_EXPIRED_TOKEN` | 401 | Token has expired. Please re-authenticate. |
| `AUTH_INVALID_TOKEN` | 401 | Token is invalid or malformed. |
| `AUTH_MISSING_HEADER` | 401 | Missing or invalid Authorization header. |
| `AUTH_FORBIDDEN` | 403 | You do not have permission to access this resource. |
| `AUTH_CHALLENGE_FAILED` | 401 | SEP-0010 challenge verification failed. |

### Validation Errors (`VAL_*`)

| Code | HTTP | Description |
|------|------|-------------|
| `VAL_INVALID_PUBLIC_KEY` | 400 | Invalid Stellar public key format. |
| `VAL_INVALID_AMOUNT` | 400 | Amount must be a positive number. |
| `VAL_MISSING_FIELD` | 400 | Required field is missing. |
| `VAL_INVALID_JSON` | 400 | Request body contains invalid JSON. |
| `VAL_BODY_TOO_LARGE` | 413 | Request body exceeds the maximum allowed size. |
| `VAL_CONTENT_TYPE` | 415 | Content-Type must be application/json. |
| `VAL_INVALID_USERNAME` | 400 | Username must be 3–20 alphanumeric characters. |
| `VAL_INVALID_STELLAR_ADDRESS` | 400 | Invalid Stellar address format. |
| `VAL_INVALID_URL` | 400 | Invalid URL format. |
| `VAL_INVALID_DATE` | 400 | Invalid ISO 8601 date format. |
| `VAL_MEMO_TOO_LONG` | 400 | Memo exceeds 28 bytes. |
| `VAL_WEAK_SECRET` | 400 | Secret must be at least 8 characters. |
| `VAL_INVALID_LIMIT` | 400 | Limit must be a positive integer. |
| `VAL_INVALID_FEDERATION_TYPE` | 400 | Federation type must be 'name' or 'id'. |

### Resource Errors (`RES_*`)

| Code | HTTP | Description |
|------|------|-------------|
| `RES_NOT_FOUND` | 404 | The requested resource was not found. |
| `RES_ACCOUNT_NOT_FOUND` | 404 | Stellar account not found. |
| `RES_CONFLICT` | 409 | Resource already exists. |
| `RES_USERNAME_CONFLICT` | 409 | Username already registered. |
| `RES_PUBLIC_KEY_CONFLICT` | 409 | Public key already registered. |
| `RES_GONE` | 410 | Resource no longer available. |
| `RES_ROUTE_NOT_FOUND` | 404 | Route not found. |

### Rate Limiting (`RATE_*`)

| Code | HTTP | Description |
|------|------|-------------|
| `RATE_LIMITED_GLOBAL` | 429 | Too many requests. Try again later. |
| `RATE_LIMITED_SENSITIVE` | 429 | Too many requests to sensitive routes. |
| `RATE_LIMITED_USER` | 429 | Too many requests from this account. |

### Contract Errors (`CONTRACT_*`)

Mapped from the Soroban contract's numeric `ContractError` codes (1–17).

| Code | HTTP | Contract Code | Description |
|------|------|---------------|-------------|
| `CONTRACT_ALREADY_INITIALIZED` | 409 | 1 | Contract already initialized. |
| `CONTRACT_UNAUTHORIZED` | 403 | 2 | Not authorized for this action. |
| `CONTRACT_NON_POSITIVE_AMOUNT` | 400 | 3 | Amount must be strictly positive. |
| `CONTRACT_RELEASE_LEDGER_IN_PAST` | 400 | 4 | Release ledger must be in the future. |
| `CONTRACT_NOT_FOUND` | 404 | 5 | Contract resource not found. |
| `CONTRACT_INVALID_STATE` | 409 | 6 | Invalid state for this operation. |
| `CONTRACT_OVERFLOW` | 500 | 7 | Arithmetic overflow. |
| `CONTRACT_INVALID_THRESHOLD` | 400 | 8 | Signers/threshold mismatch. |
| `CONTRACT_LENGTH_MISMATCH` | 400 | 9 | Array length mismatch. |
| `CONTRACT_ALREADY_SIGNED` | 409 | 10 | Already approved this proposal. |
| `CONTRACT_INSUFFICIENT_FUNDS` | 400 | 11 | Insufficient deposited funds. |
| `CONTRACT_PAUSED` | 503 | 12 | Contract is paused. |
| `CONTRACT_SELF_TRANSFER` | 400 | 13 | Cannot transfer to yourself. |
| `CONTRACT_BATCH_TOO_LARGE` | 400 | 14 | Batch size exceeds maximum. |
| `CONTRACT_DUPLICATE_SIGNER` | 400 | 15 | Duplicate signer detected. |
| `CONTRACT_PROPOSAL_EXPIRED` | 410 | 16 | Proposal has expired. |
| `CONTRACT_TRANSFER_FAILED` | 502 | 17 | Token transfer verification failed. |

### Payment Errors (`PAY_*`)

| Code | HTTP | Description |
|------|------|-------------|
| `PAY_BUILD_FAILED` | 500 | Failed to build payment transaction. |
| `PAY_SIGN_FAILED` | 400 | Failed to sign transaction. |
| `PAY_SUBMIT_FAILED` | 502 | Failed to submit to Stellar network. |
| `PAY_CONFIRMATION_TIMEOUT` | 504 | Transaction confirmation timed out. |
| `PAY_INSUFFICIENT_BALANCE` | 400 | Insufficient balance. |
| `PAY_SELF_PAYMENT` | 400 | Cannot send to your own wallet. |
| `PAY_DESTINATION_NOT_FUNDED` | 400 | Destination account does not exist. |
| `PAY_INVALID_DESTINATION` | 400 | Invalid payment destination. |
| `PAY_HORIZON_ERROR` | 502 | Stellar Horizon returned an error. |

### Server Errors (`SRV_*`)

| Code | HTTP | Description |
|------|------|-------------|
| `SRV_INTERNAL` | 500 | Internal server error. |
| `SRV_HORIZON_UNAVAILABLE` | 502 | Stellar Horizon is temporarily unavailable. |
| `SRV_FEDERATION_FAILED` | 502 | External federation resolution failed. |
| `SRV_AI_NOT_CONFIGURED` | 501 | AI payment parsing not configured. |
| `SRV_METRICS_FAILED` | 500 | Failed to collect Prometheus metrics. |
| `SRV_NOT_IMPLEMENTED` | 501 | Feature not yet implemented. |

### Generic Errors (`GEN_*`)

| Code | HTTP | Description |
|------|------|-------------|
| `GEN_UNKNOWN` | 500 | An unexpected error occurred. |
| `GEN_NETWORK_ERROR` | 0 | Network error. Check your connection. |
| `GEN_OFFLINE` | 0 | You are offline. |

---

## Rate limiting

| Limiter | Window | Limit | Applies to |
|---------|--------|-------|------------|
| Global | 15 minutes | 100 req/IP | All routes **except** `/health` and `/api/health` |
| Strict | 1 minute | 20 req/IP | `/api/accounts/*`, `/api/payments/*`, `/api/analytics/*`, `/api/tips/*`, `/api/turrets/*`, `/federation` |

Responses include `RateLimit-Limit`, `RateLimit-Remaining`, and `RateLimit-Reset` headers.

| Status | Body |
|--------|------|
| 429 (global) | `RATE_LIMITED_GLOBAL` — `{ "error": { "code": "RATE_LIMITED_GLOBAL", "message": "Too many requests. Please try again later." } }` |
| 429 (strict) | `RATE_LIMITED_SENSITIVE` — `{ "error": { "code": "RATE_LIMITED_SENSITIVE", "message": "Too many requests to sensitive routes. Please wait 1 minute." } }` |

---

## Table of contents

- [Health](#health)
- [API documentation](#api-documentation)
- [Authentication](#authentication)
- [Stellar federation](#stellar-federation)
- [Accounts](#accounts)
- [Payments](#payments)
- [Analytics](#analytics)
- [Tips](#tips)
- [Turrets (txFunctions)](#turrets-txfunctions)
- [Webhooks](#webhooks)
- [AI Payment Parsing](#ai-payment-parsing)
- [Scheduled Transactions](#scheduled-transactions)
- [Global errors](#global-errors)

---

## Health

### `GET /health`

### `GET /api/health`

Liveness probe. **Not** subject to global rate limiting.

**Response `200`**
```json
{
  "status": "ok",
  "service": "finchippay-api",
  "network": "testnet",
  "timestamp": "2025-01-01T00:00:00.000Z"
}
```

| Field | Type | Description |
|-------|------|-------------|
| status | string | Always `"ok"` when healthy |
| service | string | Service identifier |
| network | string | `STELLAR_NETWORK` env or `"testnet"` |
| timestamp | string (ISO 8601) | Server time |

---

## API documentation

### `GET /api/docs`

Serves Swagger UI (HTML).

### `GET /api/docs.json`

Returns the OpenAPI 3.0 specification as JSON.

**Response `200`** — OpenAPI document (large JSON object).

---

## Authentication

SEP-0010 Stellar Web Authentication.

### `GET /api/auth`

Issue a challenge transaction for the client to sign.

**Query parameters**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| account | string | yes | Stellar public key (`G` + 55 alphanumerics) |

**Response `200`**
```json
{
  "transaction": "<base64 XDR>",
  "networkPassphrase": "Test SDF Network ; September 2015"
}
```

**Errors**

| Status | Body |
|--------|------|
| 400 | `{ "error": "Missing account query parameter" }` |
| 400 | `{ "error": "<validation message>" }` |

---

### `POST /api/auth`

Verify a signed challenge and issue a JWT (also set as `httpOnly` cookie `jwt`).

**Request body (JSON)**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| transaction | string | yes | Signed challenge XDR (base64) |

**Example request**
```json
{
  "transaction": "AAAAAgAAAAC..."
}
```

**Response `200`**
```json
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Errors**

| Status | Body |
|--------|------|
| 400 | `{ "error": "Missing transaction in request body" }` |
| 401 | `{ "error": "Unauthorized: <reason>" }` |

---

## Stellar federation

### `GET /.well-known/stellar.toml`

SEP-0001 discovery document (TOML, not JSON).

**Response `200`** (`Content-Type: application/toml`)
```toml
# Finchippay Solution federation discovery
FEDERATION_SERVER="http://localhost:4000/federation"
```

---

### `GET /federation`

SEP-0002 federation resolver. Subject to **strict** rate limit.

**Query parameters**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| q | string | yes | For `type=name`: `username*domain`; for `type=id`: Stellar account ID (`G...`) |
| type | string | yes | `"name"` or `"id"` |

**Response `200` (type=name)**
```json
{
  "stellar_address": "alice*stellarfinchippay.io",
  "account_id": "GABC1234567890123456789012345678901234567890123456789012345"
}
```

**Response `200` (type=id)**
```json
{
  "stellar_address": "alice*stellarfinchippay.io",
  "account_id": "GABC1234567890123456789012345678901234567890123456789012345"
}
```

**Errors**

| Status | Body |
|--------|------|
| 400 | `{ "error": "Missing required parameters: q and type" }` |
| 400 | `{ "error": "Invalid required parameters: q and type must be strings" }` |
| 400 | `{ "error": "Invalid type parameter. Must be 'name' or 'id'" }` |
| 400 | `{ "error": "Invalid stellar address format" }` |
| 404 | `{ "error": "Not found" }` |
| 404 | `{ "error": "Account ID not found" }` |

---

## Accounts

### `GET /api/accounts/resolve/:username`

Resolve a registered username to a public key. Subject to **strict** rate limit.

**Path parameters**

| Name | Type | Description |
|------|------|-------------|
| username | string | 3–20 alphanumeric characters (trimmed and lowercased) |

**Response `200`**
```json
{
  "success": true,
  "data": {
    "username": "alice",
    "publicKey": "GABC1234567890123456789012345678901234567890123456789012345"
  }
}
```

**Errors**

| Status | Body |
|--------|------|
| 400 | `{ "error": "Username is required" }` |
| 400 | `{ "error": "Username must be 3-20 characters long and contain only letters and numbers" }` |
| 404 | `{ "error": "Username not found" }` |

---

### `POST /api/accounts/register`

Register a username for a Stellar public key. Subject to **strict** rate limit.

**Request body (JSON)**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| username | string | yes | 3–20 alphanumeric characters |
| publicKey | string | yes | Stellar `G...` public key (56 chars) |

**Example request**
```json
{
  "username": "alice",
  "publicKey": "GABC1234567890123456789012345678901234567890123456789012345"
}
```

**Response `201`**
```json
{
  "success": true,
  "data": {
    "username": "alice",
    "publicKey": "GABC1234567890123456789012345678901234567890123456789012345"
  },
  "message": "Username registered successfully"
}
```

**Errors**

| Status | Body |
|--------|------|
| 400 | `{ "success": false, "error": "Username and public key are required" }` |
| 400 | `{ "error": "Invalid Stellar public key format" }` |
| 409 | `{ "error": "Username already registered" }` |
| 409 | `{ "error": "Public key already registered to another username" }` |

---

### `GET /api/accounts/:publicKey`

Fetch account info and balances from Horizon. Requires JWT; caller may only access their own key. Subject to **strict** rate limit.

**Path parameters**

| Name | Type | Description |
|------|------|-------------|
| publicKey | string | Stellar `G...` public key (56 chars) |

**Headers**

| Name | Value |
|------|-------|
| Authorization | `Bearer <jwt>` |

**Response `200`**
```json
{
  "success": true,
  "data": {
    "publicKey": "GABC1234567890123456789012345678901234567890123456789012345",
    "sequence": "12345678",
    "subentryCount": 0,
    "balances": [
      {
        "assetCode": "XLM",
        "balance": "9999.9999900",
        "asset_type": "native"
      }
    ]
  }
}
```

**Errors**

| Status | Body |
|--------|------|
| 400 | `{ "error": "Invalid Stellar public key format" }` |
| 401 | `{ "error": "Unauthorized: missing or invalid token" }` |
| 401 | `{ "error": "Unauthorized: invalid or expired token" }` |
| 403 | `{ "error": "Forbidden: you may only access your own account data" }` |
| 404 | `{ "error": "Account not found. It may not be funded yet. Use Friendbot on testnet." }` |

---

### `GET /api/accounts/:publicKey/balance`

Fetch native XLM balance only. Same auth and rate-limit rules as `GET /api/accounts/:publicKey`.

**Response `200`**
```json
{
  "success": true,
  "data": {
    "publicKey": "GABC1234567890123456789012345678901234567890123456789012345",
    "xlm": "9999.9999900"
  }
}
```

**Errors** — Same as `GET /api/accounts/:publicKey`.

---

## Payments

### `GET /api/payments/:publicKey`

Payment history from Horizon. Subject to **strict** rate limit.

**Path parameters**

| Name | Type | Description |
|------|------|-------------|
| publicKey | string | Stellar `G...` public key |

**Query parameters**

| Name | Type | Default | Description |
|------|------|---------|-------------|
| limit | integer | 20 | Max results (capped at 100) |
| cursor | string | — | Horizon pagination cursor |

**Response `200`**
```json
{
  "success": true,
  "data": [
    {
      "id": "operation-id",
      "type": "sent",
      "amount": "10.0000000",
      "asset": "XLM",
      "from": "GABC...SENDER",
      "to": "GXYZ...RECIPIENT",
      "memo": "Coffee",
      "createdAt": "2025-01-01T12:00:00.000Z",
      "transactionHash": "abc123...",
      "pagingToken": "..."
    }
  ]
}
```

**Errors**

| Status | Body |
|--------|------|
| 400 | `{ "error": "Invalid Stellar public key format" }` |

---

### `GET /api/payments/:publicKey/stats`

Aggregate payment statistics (computed from up to 100 recent payments).

**Path parameters**

| Name | Type | Description |
|------|------|-------------|
| publicKey | string | Stellar `G...` public key |

**Response `200`**
```json
{
  "success": true,
  "data": {
    "publicKey": "GABC1234567890123456789012345678901234567890123456789012345",
    "totalSentXLM": "150.0000000",
    "totalReceivedXLM": "75.0000000",
    "sentCount": 12,
    "receivedCount": 5,
    "totalTransactions": 17
  }
}
```

**Errors**

| Status | Body |
|--------|------|
| 400 | `{ "error": "Invalid Stellar public key format" }` |

---

## Analytics

All analytics routes use a 5-minute in-memory cache per public key. Subject to **strict** rate limit.

### `GET /api/analytics/:publicKey/summary`

**Path parameters**

| Name | Type | Description |
|------|------|-------------|
| publicKey | string | Stellar `G...` public key |

**Response `200`**
```json
{
  "success": true,
  "data": {
    "publicKey": "GABC1234567890123456789012345678901234567890123456789012345",
    "totalSentXLM": "150.0000000",
    "totalReceivedXLM": "75.0000000",
    "uniqueCounterparties": 8,
    "averageTransactionSize": "15.0000000",
    "totalTransactions": 17
  }
}
```

---

### `GET /api/analytics/:publicKey/top-recipients`

Top 5 recipients by total XLM sent.

**Response `200`**
```json
{
  "success": true,
  "data": {
    "publicKey": "GABC1234567890123456789012345678901234567890123456789012345",
    "topRecipients": [
      {
        "address": "GXYZ...RECIPIENT",
        "totalXLMSent": "50.0000000"
      }
    ],
    "count": 1
  }
}
```

---

### `GET /api/analytics/:publicKey/activity`

Payment counts grouped by day of week (UTC).

**Response `200`**
```json
{
  "success": true,
  "data": {
    "publicKey": "GABC1234567890123456789012345678901234567890123456789012345",
    "activityByDay": [
      { "day": "Sunday", "dayIndex": 0, "transactionCount": 2 },
      { "day": "Monday", "dayIndex": 1, "transactionCount": 5 }
    ]
  }
}
```

**Errors (all analytics routes)**

| Status | Body |
|--------|------|
| 400 | `{ "error": "Invalid Stellar public key format" }` |

---

## Tips

In-memory tip ledger (v1). Subject to **strict** rate limit.

### `POST /api/tips`

Record a tip after an on-chain payment.

**Request body (JSON)**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| senderPublicKey | string | yes | Sender `G...` key |
| creatorPublicKey | string | yes | Creator `G...` key |
| amount | string | yes | Positive numeric amount |
| asset | string | no | Asset code (default `"XLM"`) |
| memo | string | no | Optional message |
| txHash | string | no | Stellar transaction hash |

**Example request**
```json
{
  "senderPublicKey": "GABC1234567890123456789012345678901234567890123456789012345",
  "creatorPublicKey": "GXYZ1234567890123456789012345678901234567890123456789012345",
  "amount": "5.0",
  "asset": "XLM",
  "memo": "Great stream!",
  "txHash": "a1b2c3..."
}
```

**Response `201`**
```json
{
  "success": true,
  "data": {
    "id": 1,
    "senderPublicKey": "GABC...",
    "creatorPublicKey": "GXYZ...",
    "amount": "5.0",
    "asset": "XLM",
    "memo": "Great stream!",
    "txHash": "a1b2c3...",
    "timestamp": "2025-01-01T12:00:00.000Z"
  },
  "message": "Tip recorded successfully"
}
```

**Errors**

| Status | Body |
|--------|------|
| 400 | `{ "error": "senderPublicKey is required, creatorPublicKey is required, ..." }` (combined validation messages) |
| 400 | `{ "error": "Invalid sender public key format" }` |
| 400 | `{ "error": "amount must be a positive number" }` |

---

### `GET /api/tips/received/:creatorPublicKey`

Tips received by a creator, with embedded stats.

**Path parameters**

| Name | Type | Description |
|------|------|-------------|
| creatorPublicKey | string | Creator `G...` key |

**Query parameters**

| Name | Type | Default | Description |
|------|------|---------|-------------|
| limit | integer | 50 | Page size |
| offset | integer | 0 | Skip count |

**Response `200`**
```json
{
  "success": true,
  "data": {
    "tips": [
      {
        "id": 1,
        "senderPublicKey": "GABC...",
        "creatorPublicKey": "GXYZ...",
        "amount": "5.0",
        "asset": "XLM",
        "memo": "",
        "txHash": "",
        "timestamp": "2025-01-01T12:00:00.000Z"
      }
    ],
    "total": 1,
    "limit": 50,
    "offset": 0,
    "stats": {
      "totalTips": 1,
      "totalByAsset": {
        "XLM": { "count": 1, "amount": "5" }
      },
      "averageTip": "5",
      "largestTip": "5",
      "smallestTip": "5"
    }
  }
}
```

---

### `GET /api/tips/stats/:creatorPublicKey`

Tip statistics for a creator.

**Response `200`**
```json
{
  "success": true,
  "data": {
    "totalTips": 10,
    "totalByAsset": {
      "XLM": { "count": 10, "amount": "50" }
    },
    "averageTip": "5",
    "largestTip": "20",
    "smallestTip": "1"
  }
}
```

---

### `GET /api/tips/sent/:senderPublicKey`

Tips sent by a user.

**Query parameters**

| Name | Type | Default | Description |
|------|------|---------|-------------|
| limit | integer | 50 | Page size |
| offset | integer | 0 | Skip count |

**Response `200`**
```json
{
  "success": true,
  "data": {
    "tips": [],
    "total": 0,
    "limit": 50,
    "offset": 0
  }
}
```

---

## Turrets (txFunctions)

Automated transaction functions (DCA, stop-loss, escrow release). Subject to **strict** rate limit (20 req/min).

Supported `type` values: `dca`, `stop_loss`, `escrow_release`.

### `GET /api/turrets`

List deployments.

**Query parameters**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| ownerPublicKey | string | no | Filter by owner `G...` key |

**Response `200`**
```json
{
  "success": true,
  "data": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "ownerPublicKey": "GABC...",
      "type": "dca",
      "status": "active",
      "config": { "intervalMinutes": 60, "amountQuote": 10, "quoteAssetCode": "USDC", "quoteAssetIssuer": null },
      "deploymentHash": "abc123...",
      "createdAt": "2025-01-01T12:00:00.000Z",
      "nextRunAt": "2025-01-01T13:00:00.000Z",
      "lastExecutedAt": null,
      "lastCheckedAt": null,
      "lastObservedPriceUsd": null,
      "lastError": null
    }
  ]
}
```

**Errors**

| Status | Body |
|--------|------|
| 400 | `{ "error": "Invalid Stellar public key format" }` |

---

### `POST /api/turrets/challenge`

Create a signing challenge (ManageData transaction XDR).

**Request body (JSON)**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| ownerPublicKey | string | yes | Owner `G...` key |
| type | string | yes | `dca`, `stop_loss`, or `escrow_release` |
| config | object | yes | Type-specific configuration |

**Example request (DCA)**
```json
{
  "ownerPublicKey": "GABC1234567890123456789012345678901234567890123456789012345",
  "type": "dca",
  "config": {
    "intervalMinutes": 60,
    "amountQuote": 10,
    "quoteAssetCode": "USDC",
    "quoteAssetIssuer": "GBBD47IF6LOC7NNYVK5WQCCFNNBX2L5TBRW2NTRU3OBMKENZ5YKF3NPS"
  }
}
```

**Response `200`**
```json
{
  "success": true,
  "data": {
    "challengeXDR": "AAAAAgAAAAC...",
    "deploymentHash": "a1b2c3d4e5f6...",
    "normalizedConfig": {
      "intervalMinutes": 60,
      "amountQuote": 10,
      "quoteAssetCode": "USDC",
      "quoteAssetIssuer": "GBBD47IF6LOC7NNYVK5WQCCFNNBX2L5TBRW2NTRU3OBMKENZ5YKF3NPS"
    },
    "networkPassphrase": "Test SDF Network ; September 2015"
  }
}
```

**Errors**

| Status | Body (examples) |
|--------|-------------------|
| 400 | `{ "error": "Invalid Stellar public key format" }` |
| 400 | `{ "error": "Unsupported txFunction type. Use 'dca', 'stop_loss', or 'escrow_release'." }` |
| 400 | `{ "error": "DCA intervalMinutes must be at least 1" }` |

---

### `POST /api/turrets/deploy`

Deploy a txFunction after signing the challenge.

**Request body (JSON)**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| ownerPublicKey | string | yes | Owner `G...` key |
| type | string | yes | `dca`, `stop_loss`, or `escrow_release` |
| config | object | yes | Same config used for challenge |
| deploymentHash | string | yes | Hash from challenge response |
| signedChallengeXDR | string | yes | Challenge XDR signed by owner |

**Response `201`**
```json
{
  "success": true,
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "ownerPublicKey": "GABC...",
    "type": "dca",
    "status": "active",
    "config": { },
    "deploymentHash": "a1b2c3...",
    "createdAt": "2025-01-01T12:00:00.000Z",
    "nextRunAt": "2025-01-01T13:00:00.000Z"
  }
}
```

**Errors**

| Status | Body (examples) |
|--------|-------------------|
| 400 | `{ "error": "Configuration hash mismatch. Recreate challenge and sign again." }` |
| 400 | `{ "error": "Asset issuer is required for non-native asset USDC" }` |
| 401 | `{ "error": "Signed challenge was not signed by the owner account" }` |

---

### `GET /api/turrets/:id`

Get a single deployment.

**Path parameters**

| Name | Type | Description |
|------|------|-------------|
| id | string (UUID) | Deployment ID |

**Response `200`** — `{ "success": true, "data": { ...deployment } }`

**Errors**

| Status | Body |
|--------|------|
| 404 | `{ "error": "txFunction not found" }` |

---

### `GET /api/turrets/:id/history`

Execution log for a deployment (newest first).

**Response `200`**
```json
{
  "success": true,
  "data": [
    {
      "id": "660e8400-e29b-41d4-a716-446655440001",
      "deploymentId": "550e8400-e29b-41d4-a716-446655440000",
      "status": "executed",
      "message": "DCA txFunction generated",
      "result": { "action": "buy_xlm_dca" },
      "createdAt": "2025-01-01T12:30:00.000Z"
    }
  ]
}
```

**Errors**

| Status | Body |
|--------|------|
| 404 | `{ "error": "txFunction not found" }` |

---

### `POST /api/turrets/:id/pause`

Pause a deployment.

**Response `200`** — `{ "success": true, "data": { ...deployment, "status": "paused" } }`

---

### `POST /api/turrets/:id/resume`

Resume a paused deployment.

**Response `200`** — `{ "success": true, "data": { ...deployment, "status": "active" } }`

---

## Webhooks

Register Horizon SSE listeners that POST to your URL when payments are received.

### `POST /api/webhooks`

**Request body (JSON)**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| publicKey | string | yes | Account to monitor |
| url | string | yes | HTTPS endpoint to receive events |
| secret | string | yes | HMAC secret for `X-Webhook-Signature` |

**Example request**
```json
{
  "publicKey": "GABC1234567890123456789012345678901234567890123456789012345",
  "url": "https://example.com/webhooks/stellar",
  "secret": "whsec_..."
}
```

**Response `201`**
```json
{
  "success": true,
  "webhook": {
    "id": "1",
    "publicKey": "GABC...",
    "url": "https://example.com/webhooks/stellar",
    "secret": "whsec_...",
    "createdAt": "2025-01-01T12:00:00.000Z"
  }
}
```

**Errors**

| Status | Body |
|--------|------|
| 400 | `{ "error": "publicKey, url, and secret are required" }` |
| 500 | `{ "error": "<message>" }` |

**Outbound webhook payload** (POST to your `url`)
```json
{
  "event": "payment.received",
  "publicKey": "GABC...",
  "payment": {
    "id": "...",
    "from": "G...",
    "to": "G...",
    "amount": "10.0000000",
    "asset": "XLM",
    "createdAt": "2025-01-01T12:00:00Z"
  }
}
```

Header: `X-Webhook-Signature` — HMAC-SHA256 hex of the JSON body using `secret`.

---

### `GET /api/webhooks/:publicKey`

List webhooks for an account.

**Response `200`**
```json
{
  "webhooks": [
    {
      "id": "1",
      "publicKey": "GABC...",
      "url": "https://example.com/webhooks/stellar",
      "secret": "whsec_...",
      "createdAt": "2025-01-01T12:00:00.000Z"
    }
  ]
}
```

---

### `DELETE /api/webhooks/:id`

Delete a webhook by numeric ID.

**Path parameters**

| Name | Type | Description |
|------|------|-------------|
| id | string | Webhook ID assigned at registration |

**Response `200`**
```json
{
  "success": true,
  "message": "Webhook 1 deleted"
}
```

**Errors**

| Status | Body |
|--------|------|
| 404 | `{ "error": "Webhook not found" }` |

---

## AI Payment Parsing

AI-powered natural language payment intent parsing using Anthropic's Claude.

Requires `ANTHROPIC_API_KEY` to be set in the backend environment. Returns **501** if not configured.

### `POST /api/parse-payment`

Parse a natural language payment description into a structured payment intent.

**Request body (JSON)**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| input | string | yes | Natural language payment description |

**Example request**
```json
{
  "input": "Send 50 XLM to GABC123 for design work"
}
```

**Response `200`**
```json
{
  "amount": "50 XLM",
  "recipient": "GABC123",
  "memo": "design work",
  "isValid": true,
  "clarification": ""
}
```

**Response `200` (ambiguous input)**
```json
{
  "amount": "",
  "recipient": "Alice",
  "memo": "job",
  "isValid": false,
  "clarification": "What amount should be sent?"
}
```

**Errors**

| Status | Body |
|--------|------|
| 400 | `{ "amount": "", "recipient": "", "memo": "", "isValid": false, "clarification": "Please provide a payment description." }` |
| 501 | `{ "amount": "", "recipient": "", "memo": "", "isValid": false, "clarification": "AI payment parsing is not configured. Set ANTHROPIC_API_KEY." }` |
| 500 | `{ "amount": "", "recipient": "", "memo": "", "isValid": false, "clarification": "Server error. Try again." }` |

---

## Scheduled Transactions

Schedule pre-signed Stellar transactions for future automatic submission.

### `POST /api/scheduled-txns`

Schedule a transaction for future submission.

**Request body (JSON)**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| signedXDR | string | yes | Signed transaction XDR (base64) |
| submitAt | string | yes | ISO 8601 timestamp when the transaction should be submitted |
| publicKey | string | yes | Stellar public key that owns this transaction |

**Example request**
```json
{
  "signedXDR": "AAAAAgAAAAC...",
  "submitAt": "2026-08-01T12:00:00Z",
  "publicKey": "GABC1234567890123456789012345678901234567890123456789012345"
}
```

**Response `201`**
```json
{
  "message": "Transaction scheduled successfully",
  "id": 1,
  "publicKey": "GABC1234567890123456789012345678901234567890123456789012345",
  "submitAt": "2026-08-01T12:00:00.000Z"
}
```

**Errors**

| Status | Body |
|--------|------|
| 400 | `{ "error": "Missing signedXDR, submitAt, or publicKey" }` |
| 400 | `{ "error": "submitAt must be a valid ISO 8601 date string" }` |

---

### `GET /api/scheduled-txns/:publicKey`

List all pending scheduled transactions for a public key (sorted by earliest first).

**Path parameters**

| Name | Type | Description |
|------|------|-------------|
| publicKey | string | Stellar `G...` public key |

**Response `200`**
```json
[
  {
    "id": 1,
    "submitAt": "2026-08-01T12:00:00.000Z",
    "publicKey": "GABC1234567890123456789012345678901234567890123456789012345",
    "attempts": 0,
    "createdAt": "2026-07-15T08:00:00.000Z"
  }
]
```

---

### `DELETE /api/scheduled-txns/:id`

Cancel a scheduled transaction by its ID.

**Path parameters**

| Name | Type | Description |
|------|------|-------------|
| id | string | Transaction ID assigned at scheduling |

**Response `200`**
```json
{
  "message": "Transaction 1 cancelled successfully."
}
```

**Errors**

| Status | Body |
|--------|------|
| 404 | `{ "error": "Transaction 1 not found or not pending." }` |

---

## Global errors

All errors now follow the standardized shape (see [Error Codes Reference](#error-codes-reference)).

| HTTP status | Error Code | When |
|-------------|------------|------|
| 400 | `VAL_INVALID_JSON` | Invalid JSON body |
| 404 | `RES_ROUTE_NOT_FOUND` | Unknown route |
| 415 | `VAL_CONTENT_TYPE` | Missing `Content-Type: application/json` |
| 413 | `VAL_BODY_TOO_LARGE` | Request body exceeds size limit |
| 429 | `RATE_LIMITED_GLOBAL` | Global rate limit exceeded |
| 429 | `RATE_LIMITED_SENSITIVE` | Strict rate limit exceeded |
| 500 | `SRV_INTERNAL` | Unhandled server error |

**Example standardized error response:**
```json
{
  "error": {
    "code": "RATE_LIMITED_GLOBAL",
    "message": "Too many requests. Please try again later."
  }
}
```

**CORS:** Requests from origins not listed in `ALLOWED_ORIGINS` are rejected by the CORS middleware.

---

## Turrets sidecar (optional)

When `TURRETS_PORT` is set (default `4100`), a separate process exposes:

| Method | Path | Description |
|--------|------|-------------|
| GET | `http://localhost:4100/health` | Sidecar health |
| * | `http://localhost:4100/tx-functions/*` | Same txFunction routes as `/api/turrets/*` on the main server |

The main API on port **4000** mounts turrets at `/api/turrets`; prefer that URL for application integration.

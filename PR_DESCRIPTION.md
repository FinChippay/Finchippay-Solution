## Description

This PR implements **SEP-0024 (Hosted Deposit and Withdrawal)** support on the Finchippay backend, enabling users to deposit fiat or non-XLM assets through regulated anchors directly from the Finchippay UI. It introduces interactive session initiation, transaction status polling, and advertises the transfer server via `stellar.toml`.

---

## Motivation

Closes #73

The backend previously implemented SEP-0010 (authentication) and SEP-0002 (federation), but not SEP-0024. Without SEP-0024, users cannot interact with anchors for fiat on/off-ramps — a critical feature for real-world adoption. This PR fills that gap by:

1. Advertising SEP-0024 support via the `stellar.toml` discovery document
2. Providing endpoints to initiate interactive deposit and withdrawal sessions
3. Exposing a polling endpoint for wallets to track transaction status through the anchor flow lifecycle

---

## What Changed

### New Files (3)

| File | Lines | Purpose |
|------|-------|---------|
| `backend/src/services/sep/sep24Service.js` | 208 | In-memory transaction state manager: `initiateDeposit`, `initiateWithdrawal`, `getTransaction`, `updateTransactionStatus` |
| `backend/src/routes/sep24.js` | 148 | Express route handlers for 3 SEP-0024 endpoints |
| `backend/__tests__/sep24.test.js` | 263 | 17 integration tests covering happy path, error states, and full lifecycle |

### Modified Files (2)

| File | Changes | Purpose |
|------|---------|---------|
| `backend/src/server.js` | +15 lines | Registered `/api/sep24` routes; added `TRANSFER_SERVER_SEP0024` to `/.well-known/stellar.toml` |
| `backend/src/swagger.js` | +329 / −40 | Added 3 schemas (`Sep24InitiateRequest`, `Sep24InteractiveResponse`, `Sep24Transaction`) + 3 endpoint docs; updated TOML example |

---

## API Endpoints

### `GET /.well-known/stellar.toml`

Now advertises SEP-0024 alongside SEP-0002:

```toml
FEDERATION_SERVER="https://stellarfinchippay.io/federation"
TRANSFER_SERVER_SEP0024="https://stellarfinchippay.io"
```

The `TRANSFER_SERVER_SEP0024` URL is resolved from `process.env.TRANSFER_SERVER_URL` (if set), otherwise derived from the request's domain and protocol (respects `x-forwarded-proto` header).

---

### `POST /api/sep24/transactions/deposit/interactive`

Initiates an interactive deposit session.

**Request** (JSON):
```json
{
  "asset_code": "USDC",                          // required: 1–12 alphanumeric chars
  "account": "GABC...XYZ",                       // required: Stellar public key
  "memo": "optional memo",                       // optional
  "memo_type": "text",                           // optional: "text" | "id" | "hash"
  "anchor_url": "https://anchor.example.com"     // optional: override anchor base URL
}
```

**Response 200**:
```json
{
  "type": "interactive_customer_info_needed",
  "url": "http://localhost:4000/kyc?transaction_id=<uuid>&asset_code=USDC&account=GABC...XYZ&kind=deposit",
  "id": "550e8400-e29b-41d4-a716-446655440000"
}
```

**Error 400** — Missing `asset_code` or `account`, invalid public key format, or invalid asset_code format.

---

### `POST /api/sep24/transactions/withdraw/interactive`

Identical request/response format as deposit, except `kind` is `withdrawal` in the stored record.

---

### `GET /api/sep24/transaction?id=<uuid>`

Polls the current status of an interactive transaction.

**Response 200**:
```json
{
  "transaction": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "kind": "deposit",
    "status": "completed",
    "status_eta": null,
    "more_info_url": "http://localhost:4000/kyc?...",
    "amount_in": null,
    "amount_out": null,
    "amount_fee": null,
    "started_at": "2026-07-21T12:00:00.000Z",
    "updated_at": "2026-07-21T12:05:00.000Z",
    "completed_at": "2026-07-21T12:05:00.000Z",
    "stellar_transaction_id": null,
    "external_transaction_id": null,
    "message": null
  }
}
```

**Error 400** — Missing `id` query parameter.
**Error 404** — Transaction not found.

---

## Transaction Lifecycle

```
  POST /transactions/deposit/interactive
           │
           ▼
    pending_external ──────────────► error
           │                        (w/ errorReason)
           │
           ▼
       completed
```

- **`pending_external`** — Initial state after initiation. User must complete KYC/information gathering via the interactive URL.
- **`completed`** — The anchor has finalized the transaction.
- **`error`** — The transaction failed (e.g., KYC rejected, insufficient funds). Includes a `message` field with the reason.

---

## Architecture Decisions

### In-Memory Store (with future persistence path)

The service uses a `Map<string, TransactionRecord>` for transaction storage. This is intentional for v1:

- Keeps the implementation simple and dependency-free
- `clearStore()` exposes a clean API for test isolation (`beforeEach` in tests)
- The internal `_createTransaction`, `_validateInput`, and `_buildInteractiveUrl` helpers are private functions — only the public API (`initiateDeposit`, `initiateWithdrawal`, `getTransaction`, `updateTransactionStatus`) is exported, making a future swap to a database a drop-in replacement

### Input Validation

- **`asset_code`**: Validated as 1–12 alphanumeric characters (per SEP-0001 asset code spec)
- **`account`**: Validated as `G` + 55 base32 characters (`/^G[A-Z0-9]{55}$/`)
- Both validations happen in the service layer (`_validateInput`) so the route handlers remain thin

### URL Construction

The interactive URL is built by `_buildInteractiveUrl()` with all parameters properly URI-encoded. The base URL is resolved from:
1. `anchor_url` request body parameter (allows test/development overrides)
2. `TRANSFER_SERVER_URL` environment variable
3. Fallback: `http://localhost:4000`

### Rate Limiting

SEP-24 endpoints are protected by the **global rate limiter** (100 req / 15 min / IP) which is applied to all routes. Intentional choice over the strict limiter (20 req / 1 min) since SEP-24 endpoints are called programmatically by wallets during integration flows and polling loops.

### Response Format

The `GET /api/sep24/transaction` response follows the SEP-0024 spec exactly — all fields from the spec are present (e.g., `amount_in`, `amount_out`, `stellar_transaction_id`, `external_transaction_id`), even if currently `null`. This ensures wallet SDK compatibility without additional parsing.

---

## How to Test

### Automated Tests

```bash
cd backend

# Run SEP-24 test suite in isolation (17 tests)
npx jest __tests__/sep24.test.js --verbose

# Run full backend test suite (123 tests across 13 suites)
npx jest --verbose

# Lint
ESLINT_USE_FLAT_CONFIG=false npx eslint 'src/**/*.js'

# Format check
npx prettier --check 'src/**/*.js' '__tests__/**/*.js'
```

**CI results (local):**
- ✅ 123/123 tests passed
- ✅ ESLint: 0 errors
- ✅ Prettier: all files formatted

### Manual Testing with curl

```bash
# 1. Verify stellar.toml advertises SEP-0024
curl -s http://localhost:4000/.well-known/stellar.toml
# Should contain: TRANSFER_SERVER_SEP0024=

# 2. Initiate a deposit
curl -s -X POST http://localhost:4000/api/sep24/transactions/deposit/interactive \
  -H "Content-Type: application/json" \
  -d '{"asset_code":"USDC","account":"GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"}'
# Response: { "type": "interactive_customer_info_needed", "url": "...", "id": "<uuid>" }

# 3. Poll transaction status (use the id from step 2)
curl -s "http://localhost:4000/api/sep24/transaction?id=<uuid>"
# Response: { "transaction": { "status": "pending_external", ... } }

# 4. Initiate a withdrawal
curl -s -X POST http://localhost:4000/api/sep24/transactions/withdraw/interactive \
  -H "Content-Type: application/json" \
  -d '{"asset_code":"USDC","account":"GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"}'

# 5. Test error cases
curl -s -X POST http://localhost:4000/api/sep24/transactions/deposit/interactive \
  -H "Content-Type: application/json" \
  -d '{"account":"GAAAAA..."}'
# Response: 400 { "error": "asset_code and account are required" }

curl -s "http://localhost:4000/api/sep24/transaction"
# Response: 400 { "error": "Missing required query parameter: id" }

curl -s "http://localhost:4000/api/sep24/transaction?id=00000000-0000-0000-0000-000000000000"
# Response: 404 { "error": "Transaction not found" }
```

### Swagger UI

Start the backend and visit `http://localhost:4000/api/docs` — the three new SEP-0024 endpoints appear under the **SEP-0024** tag with full request/response schemas.

---

## Test Coverage Breakdown

The 17 tests in `__tests__/sep24.test.js` cover:

| Category | Tests | What's Covered |
|----------|-------|----------------|
| **stellar.toml** | 1 | Verifies `TRANSFER_SERVER_SEP0024` is present alongside `FEDERATION_SERVER` |
| **Deposit initiation** | 6 | Happy path (url + id returned), optional memo/memo_type, anchor_url override, missing asset_code (400), missing account (400), invalid public key (400) |
| **Withdrawal initiation** | 2 | Happy path, missing fields (400) |
| **Status polling** | 6 | `pending_external` state, `completed` transition, `error` transition w/ message, missing id param (400), non-existent id (404), withdrawal `kind` field |
| **E2E flow** | 2 | Full lifecycle: initiate → poll pending → mark completed → poll completed; error lifecycle: initiate → mark error → poll error w/ message |

---

## Known Limitations & Future Work

| Item | Status |
|------|--------|
| In-memory store (volatile across restarts) | Intentional for v1 — swap to SQLite/Postgres in future PR |
| Anchor's interactive web view (`/kyc` route) | Placeholder — actual KYC UI to be built separately |
| `amount_in` / `amount_out` / `amount_fee` fields | Hardcoded `null` — to be populated when anchor integration is live |
| `stellar_transaction_id` / `external_transaction_id` | Hardcoded `null` — to be populated on actual deposit/withdrawal completion |
| `claimable_balance_supported` parameter | Not yet implemented — future enhancement for SEP-0024 v2 |
| Persistent DB migration | When swapping the in-memory store, `initiateDeposit` / `initiateWithdrawal` / `getTransaction` / `updateTransactionStatus` signatures remain unchanged |

---

## References

- [SEP-0024: Hosted Deposit and Withdrawal](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0024.md)
- [SEP-0001: stellar.toml](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0001.md)
- Existing SEP-0010 implementation: `backend/src/routes/auth.js`
- Existing SEP-0002 implementation: `backend/src/routes/federation.js`

---

## Checklist

- [x] `stellar.toml` endpoint returns valid TOML with `TRANSFER_SERVER_SEP0024`
- [x] Deposit initiation returns `{ type: 'interactive_customer_info_needed', url, id }`
- [x] Withdrawal initiation returns same response format
- [x] Transaction status polling returns `pending_external`, `completed`, and `error` states
- [x] Swagger docs updated with all 3 endpoints and schemas
- [x] Integration tests for happy path and error states (17 tests)
- [x] All 123 existing backend tests continue to pass
- [x] ESLint: 0 errors
- [x] Prettier: formatting compliant
- [x] Input validation: asset_code (1–12 alphanumeric) + public key (G…55 chars)
- [x] Rate limiting applied via global limiter (100 req / 15 min / IP)
